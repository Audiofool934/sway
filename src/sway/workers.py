"""Separate processes keep video-language work off the music generation path."""

import ctypes
import queue
import sys
import time
import traceback

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


def music_worker(controls, accents, audio, status, stop, initial):
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
        from .music import MusicEngine, NotePlanner, style_prompt

        engine = MusicEngine()
        planner = NotePlanner()
        for action in ACTION_STYLES:
            engine.style.embed(style_prompt(initial["palette"], action))
        current = initial
        identity = (current["palette"], current["action"])
        engine.set_style(*identity)
        for _ in range(5):
            engine.generate()
        latest(status, {"worker": "music", "phase": "ready", "interactive_thread": interactive})
        deadline = time.monotonic()
        gain = 0.0
        overruns = 0
        dropped = 0
        while not stop.is_set():
            try:
                while True:
                    current = controls.get_nowait()
            except queue.Empty:
                pass
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
            notes = planner.next(
                current["bpm"],
                current["action"],
                accent,
                current.get("articulation", "unknown"),
                register=current.get("register", 0.5),
                guided=current.get("guided", False),
            )
            requested = time.monotonic()
            note_guidance = 5.0 if current.get("guided") else 1.0
            samples = engine.generate(notes, note_guidance=note_guidance)
            frame_ms = (time.monotonic() - requested) * 1000
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
                    "beat": planner.beat,
                    "note_cues": planner.cue_count,
                    "last_pitch": planner.last_pitch,
                    "note_guidance": note_guidance,
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


def semantic_worker(clips, status, stop):
    try:
        from .semantics import SemanticModel

        model = SemanticModel()
        latest(status, {"worker": "semantics", "phase": "ready"})
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
                    },
                )
            except (ValueError, KeyError, TypeError) as exc:
                latest(status, {"worker": "semantics", "phase": "ready", "last_error": str(exc)})
    except Exception as exc:
        traceback.print_exc()
        latest(status, {"worker": "semantics", "phase": "error", "error": str(exc)})
