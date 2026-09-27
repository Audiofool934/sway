"""Separate processes keep video-language work off the music generation path."""

import ctypes
import math
import queue
import sys
import time
import traceback
from concurrent.futures import ThreadPoolExecutor

import numpy as np


def latest(target, value):
    """Bounded latest-value mailbox. A full queue must not stall the audio producer."""
    try:
        target.put_nowait(value)
    except queue.Full:
        try:
            target.get_nowait()
        except queue.Empty:
            pass
        try:
            target.put_nowait(value)
        except queue.Full:
            pass


def music_worker(controls, accents, audio, status, stop, initial, engine=None):
    style_pool = None
    try:
        # A macOS audio worker is interactive work even without its own app window.
        # Set this before MLX creates native worker threads and GPU command queues.
        interactive = False
        if sys.platform == "darwin":
            runtime = ctypes.CDLL("/usr/lib/libSystem.B.dylib")
            promote = runtime.pthread_set_qos_class_self_np
            promote.argtypes = (ctypes.c_uint, ctypes.c_int)
            promote.restype = ctypes.c_int
            interactive = promote(0x21, 0) == 0  # QOS_CLASS_USER_INTERACTIVE, sys/qos.h.
        from .config import ACTION_STYLES
        from .ensemble import EnsemblePulse, MusicalClock
        from .music import MusicEngine, NotePlanner, style_prompt
        from .schema import Arrangement

        if engine is None:
            engine = MusicEngine()
        else:
            engine.reset()
        planner = NotePlanner()
        ensemble_pulse = EnsemblePulse()
        clock = MusicalClock(initial["bpm"])
        conducted = initial.get("conducted", False)
        arrangement = Arrangement.model_validate(initial["arrangement"]) if conducted else None
        applied_revision = initial.get("arrangement_revision", 0)
        if not conducted:
            for action in ACTION_STYLES:
                engine.style.embed(style_prompt(initial["palette"], action))
        current = initial
        identity = (current["palette"], current["action"])
        if conducted:
            engine.set_arrangement(current["palette"], arrangement, clock.bpm)
        else:
            engine.set_style(*identity)
        style_bpm = clock.bpm
        pending_style = prepared_style = None
        preparing = None
        if conducted:
            # Text encoding can take hundreds of milliseconds. Its TFLite interpreter is
            # separate from the quantizer used by generation, so prepare it off this thread.
            style_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="sway-style")
        for _ in range(5):
            engine.generate()
        latest(status, {"worker": "music", "phase": "ready", "interactive_thread": interactive})
        deadline = time.monotonic()
        gain = 0.0
        overruns = 0
        dropped = 0
        while not stop.is_set():
            frame_started = time.monotonic()
            try:
                while True:
                    current = controls.get_nowait()
            except queue.Empty:
                pass
            boundary = clock.advance(current["bpm"])
            if conducted:
                revision = current.get("arrangement_revision", 0)
                if pending_style is not None and pending_style.done():
                    prepared_style = (*preparing, pending_style.result())
                    pending_style = None
                if boundary and prepared_style is not None and prepared_style[0] == revision:
                    applied_revision, arrangement, style_bpm, embedding = prepared_style
                    engine.apply_style(embedding)
                    prepared_style = None
                wanted = (revision, clock.bpm)
                ready = (prepared_style[0], prepared_style[2]) if prepared_style else None
                if (
                    pending_style is None
                    and wanted != (applied_revision, style_bpm)
                    and wanted != ready
                ):
                    requested_arrangement = Arrangement.model_validate(current["arrangement"])
                    preparing = (revision, requested_arrangement, clock.bpm)
                    pending_style = style_pool.submit(
                        engine.prepare_arrangement,
                        current["palette"],
                        requested_arrangement,
                        clock.bpm,
                    )
            elif not conducted:
                changed = (current["palette"], current["action"])
                if changed != identity:
                    engine.set_style(*changed)
                    identity = changed
            accent = None
            try:
                event = accents.get_nowait()
                if time.monotonic() - event["time"] <= 0.4:
                    accent = event["finger"] if event["finger"] is not None else 0
            except queue.Empty:
                pass
            if conducted:
                notes = ensemble_pulse.next(clock.beat, arrangement)
            else:
                notes = planner.next(
                    clock.bpm,
                    current["action"],
                    accent,
                    current.get("articulation", "unknown"),
                    register=current.get("register", 0.5),
                    guided=current.get("guided", False),
                    beat=clock.beat,
                )
            note_guidance = 3.0 if conducted else 5.0 if current.get("guided") else 1.0
            samples = engine.generate(notes, note_guidance=note_guidance)
            frame_ms = (time.monotonic() - frame_started) * 1000
            if conducted:
                expressive_gain = 0.45 + 0.3 * arrangement.energy
                target = gain + (1 - math.exp(-0.04 / 1.0)) * (expressive_gain - gain)
            else:
                expressive_gain = (
                    0.3 + 0.6 * current.get("energy", 0) if current.get("guided") else 0.65
                )
                target = current.get("tracking_gain", 1.0) * expressive_gain
            ramp = np.linspace(gain, target, len(samples), dtype=np.float32)
            samples *= ramp[:, None]
            gain = target
            if frame_ms > 40:
                overruns += 1
            packet = (
                samples.tobytes(),
                {
                    "frame_ms": round(frame_ms, 2),
                    "model_ms": round(engine.last_ms, 2),
                    "frames": engine.frame - 5,
                    "overruns": overruns,
                    "dropped_frames": dropped,
                    "beat": clock.beat,
                    "bpm": round(clock.bpm, 1),
                    "tempo_target": current["bpm"],
                    "note_cues": (ensemble_pulse if conducted else planner).cue_count,
                    "last_pitch": (ensemble_pulse if conducted else planner).last_pitch,
                    "note_guidance": note_guidance,
                    "control_seq": current.get("control_seq", 0),
                    "arrangement_revision": applied_revision,
                    "ensemble_parts": [part.model_dump() for part in arrangement.parts]
                    if conducted
                    else [],
                    "arrangement_description": arrangement.description if conducted else "",
                },
            )
            try:
                audio.put_nowait(packet)
            except queue.Full:
                dropped += 1
            deadline += 0.04
            if deadline < time.monotonic() - 0.4:
                deadline = time.monotonic()
            stop.wait(max(0, deadline - time.monotonic()))
    except Exception as exc:
        traceback.print_exc()
        latest(status, {"worker": "music", "phase": "error", "error": str(exc)})
    finally:
        if style_pool is not None:
            style_pool.shutdown(wait=True, cancel_futures=True)


def semantic_worker(clips, status, stop, backend="local"):
    model = None
    try:
        from .qwen import QwenRequestError
        from .semantics import create_semantic_model

        model = create_semantic_model(backend)
        latest(status, {"worker": "semantics", "phase": "ready", "provider": backend})
        while not stop.is_set():
            try:
                clip = clips.get(timeout=0.5)
            except queue.Empty:
                continue
            if time.monotonic() - clip["received_at"] > 3:
                continue
            started = time.monotonic()
            try:
                result = model.interpret(clip["frames"], clip["timestamps_ms"], clip["motion"])
                latest(
                    status,
                    {
                        "worker": "semantics",
                        "phase": "ready",
                        "intent": result.model_dump(),
                        "last_error": None,
                        "received_at": clip["received_at"],
                        "inference_ms": round((time.monotonic() - started) * 1000),
                        **getattr(model, "last_metrics", {}),
                    },
                )
            except QwenRequestError as exc:
                latest(
                    status,
                    {
                        "worker": "semantics",
                        "phase": "ready" if exc.retryable else "error",
                        "last_error" if exc.retryable else "error": str(exc),
                    },
                )
                if not exc.retryable:
                    return
                stop.wait(exc.backoff)
            except (ValueError, KeyError, TypeError) as exc:
                latest(status, {"worker": "semantics", "phase": "ready", "last_error": str(exc)})
    except Exception as exc:
        traceback.print_exc()
        latest(status, {"worker": "semantics", "phase": "error", "error": str(exc)})
    finally:
        if model is not None and hasattr(model, "close"):
            model.close()
