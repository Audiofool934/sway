"""The steered instrument: the hands steer the direction, and MRT2 writes every note.

docs/motion-to-music.md measured this design as "steered". Height moves the style from a
low register to a high one, activity from calm to lively, spread opens the harmony from
the A minor triad to the whole scale, and stillness silences every pitch and fades the
output.
"""

import time

import numpy as np
from fastapi import APIRouter, WebSocket
from pydantic import BaseModel, ConfigDict, Field

from .harmony import assets_ready
from .steering import REST, Move, Quick, Steered
from .stream import StreamService, promote_thread

router = APIRouter()


class Control(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    seq: int = Field(default=0, ge=0, le=2**31 - 1)
    height: float = Field(default=0.5, ge=0, le=1)
    activity: float = Field(default=0, ge=0, le=1)  # Below steering.REST is stillness.
    spread: float = Field(default=0.5, ge=0, le=1)


class Instrument(Steered):
    """Steered as measured, with `Quick`'s fade on stillness."""

    name = "steered"
    fade = Quick.fade


class SteeredRenderer:
    """Own the model on one thread; each control conditions the next 40 ms frame."""

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
            self.instrument = Instrument(self.engine)
            # Compile before the browser starts its performance clock.
            self.engine.generate(np.zeros(128, dtype=np.int32), drumless=True)
        self.instrument.start(seed)
        self.frames = 0
        return {"interactive": self.interactive}

    def render(self, control):
        started = time.perf_counter()
        move = Move(height=control.height, activity=control.activity, spread=control.spread)
        audio = self.instrument.render(move)
        self.frames += 1
        still = control.activity < REST
        return audio.astype("<f4").tobytes(), {
            "seq": control.seq,
            "frame": self.frames,
            "modelMs": round((time.perf_counter() - started) * 1000, 1),
            "weights": self.instrument.weights.round(3).tolist(),
            "pitchClasses": [] if still else sorted(Steered.pitch_classes(control.spread)),
            "gain": round(self.instrument.gain, 3),
        }

    def idle(self, until):
        self.engine.keep_busy(until)


class SteeredService(StreamService):
    name = "steered"
    control = Control
    busy = "A steered performance is already open"

    def __init__(self, renderer=None):
        super().__init__(renderer or SteeredRenderer())

    def ready(self):
        return assets_ready()

    def release(self, control):
        return control.model_copy(update={"activity": 0})


SERVICE = SteeredService()


@router.websocket("/api/steered/stream")
async def stream(websocket: WebSocket):
    await SERVICE.connect(websocket)
