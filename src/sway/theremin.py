"""A gesture-steered MRT2 stream, with no autonomous accompaniment or bar queue."""

import time

import numpy as np
from fastapi import APIRouter, WebSocket
from pydantic import BaseModel, ConfigDict, Field

from .harmony import assets_ready
from .stream import StreamService, promote_thread

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
            self.interactive = promote_thread()
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


class ThereminService(StreamService):
    name = "theremin"
    control = Control
    busy = "A theremin performance is already open"

    def __init__(self, renderer=None):
        super().__init__(renderer or ThereminRenderer())

    def ready(self):
        return assets_ready()

    def release(self, control):
        return control.model_copy(update={"active": False, "energy": 0})


SERVICE = ThereminService()


@router.websocket("/api/theremin/stream")
async def stream(websocket: WebSocket):
    await SERVICE.connect(websocket)
