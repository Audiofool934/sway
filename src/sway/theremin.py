"""A gesture-steered MRT2 stream, with no autonomous accompaniment or bar queue."""

import asyncio
import ctypes
import logging
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlsplit

import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .harmony import assets_ready

log = logging.getLogger(__name__)
router = APIRouter()

STYLES = (
    "An intimate solo cello, warm bowed strings, long legato tones, delicate bow texture, "
    "instrumental, no percussion",
    "A luminous chamber string ensemble, layered cello and viola harmonics, "
    "slow swelling sustained tones, instrumental, no percussion",
    "Intimate pizzicato cello and plucked viola strings, short dry woody notes, "
    "delicate rhythmic articulation, instrumental, no percussion",
)
SCALE = tuple(p for p in range(36, 85) if p % 12 in {9, 11, 0, 2, 4, 5, 7})


class Control(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    seq: int = Field(default=0, ge=0, le=2**31 - 1)
    pitch: int = Field(default=57, ge=48, le=76)
    spread: float = Field(default=0.3, ge=0, le=1)
    grain: float = Field(default=0, ge=0, le=1)
    energy: float = Field(default=0, ge=0, le=1)
    active: bool = False
    accent: int = Field(default=0, ge=0, le=2**31 - 1)


class ThereminRenderer:
    """Own the model on one thread; changes condition the next 40 ms audio frame."""

    def __init__(self, factory=None):
        self.factory = factory
        self.engine = None

    def start(self, seed):
        if self.engine is None:
            # Raise this thread to macOS's interactive priority before MLX creates
            # its native threads. Camera processing must not starve the audio stream.
            self.interactive = False
            if sys.platform == "darwin":
                runtime = ctypes.CDLL("/usr/lib/libSystem.B.dylib")
                promote = runtime.pthread_set_qos_class_self_np
                promote.argtypes = (ctypes.c_uint, ctypes.c_int)
                promote.restype = ctypes.c_int
                self.interactive = promote(0x21, 0) == 0
            if self.factory is None:
                from .music import MusicEngine

                self.factory = MusicEngine
            self.engine = self.factory()
            self.styles = np.stack([self.engine.style.embed(text) for text in STYLES])
            # Compile before the browser starts its performance clock.
            self.engine.generate(np.zeros(128, dtype=np.int32), drumless=True)
        self.engine.reset(seed)
        self.weights = np.array([1.0, 0.0, 0.0], dtype=np.float32)
        self.engine.current = self.styles[0].copy()
        self.engine.apply_style(self.engine.current)
        self.engine.style_tokens = self.engine.style.tokens(self.engine.current)
        self.held = set()
        self.last_accent = 0
        self.last_strike = -100.0
        self.frames = 0
        return {"interactive": self.interactive}

    def render(self, control):
        started = time.perf_counter()
        target = np.array(
            [
                (1 - control.grain) * (1 - control.spread),
                (1 - control.grain) * control.spread,
                control.grain,
            ],
            dtype=np.float32,
        )
        self.weights += 0.18 * (target - self.weights)
        embedding = self.weights @ self.styles
        # The renderer smooths the mixture. MRT2 quantizes it every five frames.
        self.engine.current = embedding.copy()
        self.engine.apply_style(embedding)

        now = self.frames * 0.04
        struck = control.accent != self.last_accent
        self.last_accent = control.accent
        if struck:
            self.last_strike = now
        sounding = control.active and control.energy > 0.025
        if control.grain > 0.55 and now - self.last_strike > 0.24:
            sounding = False
        pitches = set()
        if sounding:
            base = min(SCALE, key=lambda p: abs(p - control.pitch))
            pitches.add(base)
            if control.spread > 0.42:
                pitches.add(base - 12)
            if control.spread > 0.72:
                pitches.add(SCALE[min(len(SCALE) - 1, SCALE.index(base) + 2)])
        notes = np.zeros(128, dtype=np.int32)
        for pitch in pitches:
            notes[pitch] = 2 if struck or pitch not in self.held else 1
        self.held = pitches
        audio = self.engine.generate(notes, drumless=True, note_guidance=3.0)
        self.frames += 1
        return audio.astype("<f4").tobytes(), {
            "seq": control.seq,
            "frame": self.frames,
            "modelMs": round((time.perf_counter() - started) * 1000, 1),
            "weights": self.weights.round(3).tolist(),
            "pitches": sorted(pitches),
        }


class ThereminService:
    def __init__(self, renderer=None):
        self.renderer = renderer or ThereminRenderer()
        self.executor = None
        self.owner = None

    async def call(self, fn, *args):
        if self.executor is None:
            self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="sway-theremin")
        future = asyncio.get_running_loop().run_in_executor(self.executor, fn, *args)
        try:
            return await asyncio.shield(future)
        except asyncio.CancelledError:
            # Finish the one in-flight model frame before releasing session ownership.
            await future
            raise

    async def close(self):
        if self.executor is not None:
            self.executor.shutdown(wait=True, cancel_futures=True)
            self.executor = None

    async def connect(self, websocket):
        origin = websocket.headers.get("origin")
        if websocket.url.hostname not in ("127.0.0.1", "localhost", "testserver") or (
            origin and urlsplit(origin).netloc != websocket.headers.get("host")
        ):
            await websocket.close(code=1008)
            return
        if self.owner is not None:
            await websocket.close(code=1008, reason="A theremin performance is already open")
            return
        if not assets_ready():
            await websocket.close(code=1008, reason="Local MRT2 assets are missing")
            return
        owner = object()
        self.owner = owner
        control = Control()
        received = time.monotonic()

        async def receive():
            nonlocal control, received
            while True:
                message = await websocket.receive_text()
                if len(message) > 2048:
                    await websocket.close(code=1009)
                    return
                try:
                    candidate = Control.model_validate_json(message)
                except ValidationError:
                    await websocket.close(code=1008, reason="Invalid musical controls")
                    return
                if candidate.seq >= control.seq:
                    control, received = candidate, time.monotonic()

        receiver = None
        try:
            await websocket.accept()
            receiver = asyncio.create_task(receive())
            seed = time.time_ns() % (2**31 - 1)
            await websocket.send_json({"type": "loading"})
            prepared = await self.call(self.renderer.start, seed)
            if receiver.done():
                return
            await websocket.send_json(
                {"type": "ready", "seed": seed, "sampleRate": 48000, **prepared}
            )
            deadline = time.monotonic()
            while not receiver.done():
                current = control
                # A disconnected/frozen controller must not sustain a note forever.
                if time.monotonic() - received > 0.6:
                    current = current.model_copy(update={"active": False, "energy": 0})
                render_started = time.monotonic()
                audio, stats = await self.call(self.renderer.render, current)
                stats["renderMs"] = round((time.monotonic() - render_started) * 1000, 1)
                if receiver.done():
                    break
                if stats["frame"] % 5 == 0:
                    await asyncio.wait_for(
                        websocket.send_json({"type": "frame", **stats}), timeout=2
                    )
                await asyncio.wait_for(websocket.send_bytes(audio), timeout=2)
                deadline = max(deadline + 0.04, time.monotonic() - 0.08)
                await asyncio.sleep(max(0, deadline - time.monotonic()))
        except (WebSocketDisconnect, TimeoutError):
            pass
        except Exception:
            log.exception("Theremin generation stopped")
            try:
                await websocket.close(code=1011, reason="Sound generation stopped; please restart")
            except (RuntimeError, WebSocketDisconnect):
                pass
        finally:
            if receiver is not None:
                receiver.cancel()
                await asyncio.gather(receiver, return_exceptions=True)
            if self.owner is owner:
                self.owner = None


SERVICE = ThereminService()


@router.websocket("/api/theremin/stream")
async def stream(websocket: WebSocket):
    await SERVICE.connect(websocket)
