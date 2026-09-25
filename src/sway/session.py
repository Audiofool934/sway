"""Session lifecycle, process ownership, recording, and bounded data delivery."""

import asyncio
import json
import multiprocessing as mp
import queue
import shutil
import time
import uuid
from datetime import UTC, datetime

import numpy as np
import soundfile as sf

from .config import RECORDINGS
from .controller import MusicalController
from .motion import MotionAnalyzer
from .schema import MotionFrame, SemanticIntent, SessionOptions
from .workers import latest, music_worker, semantic_worker


class Session:
    def __init__(self):
        self.running = False
        self.controller = MusicalController(SessionOptions())
        self.motion = MotionAnalyzer()
        self.clients = set()
        self.processes = []
        self.task = None
        self.stop_event = None
        self.queues = []
        self.workers = {"music": {"phase": "idle"}, "semantics": {"phase": "idle"}}
        self.metrics = {}
        self.recording_error = None
        self.recording = None
        self.recording_path = None
        self.last_recording = None
        self.last_clip = 0
        self.started_at = None
        self.lifecycle = asyncio.Lock()

    async def start(self, options: SessionOptions):
        async with self.lifecycle:
            if self.running:
                return
            self.controller = MusicalController(options)
            self.motion = MotionAnalyzer()
            self.metrics = {}
            self.recording_error = None
            self.last_clip = 0
            self.started_at = time.monotonic()
            ctx = mp.get_context("spawn")
            self.stop_event = ctx.Event()
            self.controls = ctx.Queue(2)
            self.accents = ctx.Queue(32)
            self.audio = ctx.Queue(8)
            self.status = ctx.Queue(32)
            self.clips = ctx.Queue(1)
            self.queues = [self.controls, self.accents, self.audio, self.status, self.clips]
            self.workers = {
                "music": {"phase": "loading"},
                "semantics": {"phase": "loading" if options.semantics else "off"},
            }
            self.processes = [
                ctx.Process(
                    target=music_worker,
                    name="sway-music",
                    args=(
                        self.controls,
                        self.accents,
                        self.audio,
                        self.status,
                        self.stop_event,
                        self.controller.snapshot(time.monotonic()),
                    ),
                )
            ]
            if options.semantics:
                self.processes.append(
                    ctx.Process(
                        target=semantic_worker,
                        name="sway-semantics",
                        args=(self.clips, self.status, self.stop_event),
                    )
                )
            try:
                for process in self.processes:
                    process.start()
                self.running = True
                self.task = asyncio.create_task(self.pump())
            except BaseException:
                await self._stop()
                raise

    async def stop(self):
        async with self.lifecycle:
            await self._stop()

    async def _stop(self):
        self.running = False
        if self.stop_event:
            self.stop_event.set()
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except (asyncio.CancelledError, Exception):
                pass
            self.task = None
        self.stop_recording()
        for process in self.processes:
            if process.pid is None:
                continue
            await asyncio.to_thread(process.join, 2)
            if process.is_alive():
                process.terminate()
                await asyncio.to_thread(process.join, 2)
            if process.is_alive():
                process.kill()
                await asyncio.to_thread(process.join, 2)
            process.close()
        self.processes = []
        for mailbox in self.queues:
            mailbox.cancel_join_thread()
            mailbox.close()
        self.queues = []
        self.workers = {"music": {"phase": "idle"}, "semantics": {"phase": "idle"}}

    def observe(self, frame: MotionFrame):
        now = time.monotonic()
        rhythm = self.motion.update(frame)
        self.controller.motion(rhythm, now)
        if self.running:
            latest(self.controls, self.controller.snapshot(now))
            if rhythm.event:
                try:
                    self.accents.put_nowait({"time": now, "finger": rhythm.finger})
                except queue.Full:
                    pass

    def submit_clip(self, clip: dict):
        now = time.monotonic()
        if (
            not self.running
            or self.workers["semantics"]["phase"] != "ready"
            or now - self.last_clip < 1.5
        ):
            return False
        self.last_clip = now
        clip["received_at"] = now
        clip["motion"] = self.controller.snapshot(now)["rhythm"]
        latest(self.clips, clip)
        return True

    def snapshot(self):
        return {
            "running": self.running,
            "workers": self.workers,
            "metrics": self.metrics,
            "music": self.controller.snapshot(time.monotonic()),
            "recording": bool(self.recording),
            "last_recording": self.last_recording,
            "recording_error": self.recording_error,
            "elapsed": time.monotonic() - self.started_at if self.running else 0,
        }

    def start_recording(self):
        if not self.running or self.workers["music"]["phase"] != "ready":
            raise ValueError("Start the music before recording")
        if self.recording:
            return
        RECORDINGS.mkdir(parents=True, exist_ok=True)
        if shutil.disk_usage(RECORDINGS).free < 1024**3:
            raise ValueError("Recording needs at least 1 GB of free disk space")
        stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
        self.recording_path = RECORDINGS / f"sway-{stamp}-{uuid.uuid4().hex[:8]}.wav"
        self.recording = sf.SoundFile(
            self.recording_path, mode="w", samplerate=48000, channels=2, subtype="PCM_16"
        )
        self.recording_error = None

    def stop_recording(self):
        if self.recording:
            recording = self.recording
            self.recording = None
            try:
                recording.close()
                self.last_recording = self.recording_path.name
                self.recording_path.with_suffix(".json").write_text(
                    json.dumps(self.snapshot(), indent=2) + "\n"
                )
            except (OSError, sf.LibsndfileError) as exc:
                self.recording_error = f"Could not finish the recording: {exc}"

    async def publish(self, packet):
        for client in tuple(self.clients):
            if client.full():
                try:
                    client.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            client.put_nowait(packet)

    async def pump(self):
        last_status = 0
        last_disk = 0
        while self.running:
            now = time.monotonic()
            try:
                while True:
                    update = self.status.get_nowait()
                    worker = update.pop("worker")
                    self.workers[worker].update(update)
                    if "intent" in update:
                        age = now - update["received_at"]
                        self.workers[worker]["stale"] = age > 6
                        if age <= 6:
                            self.controller.semantic(SemanticIntent(**update["intent"]), now)
            except queue.Empty:
                pass
            for process in self.processes:
                worker = "music" if process.name == "sway-music" else "semantics"
                if not process.is_alive() and self.workers[worker]["phase"] != "error":
                    self.workers[worker].update(phase="error", error="Worker exited unexpectedly")
            try:
                for _ in range(8):
                    raw, metrics = self.audio.get_nowait()
                    self.metrics = metrics
                    if self.recording:
                        try:
                            self.recording.write(
                                np.frombuffer(raw, dtype=np.float32).reshape(-1, 2)
                            )
                        except (OSError, sf.LibsndfileError) as exc:
                            self.stop_recording()
                            self.recording_error = f"Recording stopped: {exc}"
                    await self.publish(raw)
            except queue.Empty:
                pass
            if now - last_status > 0.1:
                latest(self.controls, self.controller.snapshot(now))
                await self.publish(self.snapshot())
                last_status = now
            if self.recording and now - last_disk > 5:
                last_disk = now
                if shutil.disk_usage(RECORDINGS).free < 512 * 1024**2:
                    self.stop_recording()
                    self.recording_error = "Recording stopped because disk space is low"
            await asyncio.sleep(0.01)
