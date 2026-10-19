"""The steered instrument: the hands steer the direction, and MRT2 writes every note.

docs/motion-to-music.md measured this design as "steered". Height moves the style from a
low register to a high one, activity from calm to lively, and spread opens the harmony.
It plays on V2's spine by default (`steering.Spine`): a bar grid and chords, harmony that
changes on bar lines, and stillness that thins the music. The free variant, without the
spine, opens the harmony from the A minor triad to the whole scale, and its stillness
silences every pitch and fades the output.
"""

import time

import numpy as np
from fastapi import APIRouter, WebSocket
from pydantic import BaseModel, ConfigDict, Field

from .harmony import assets_ready
from .steering import REST, Live, Move, Spine, Steered
from .stream import StreamService, promote_thread

router = APIRouter()


class Control(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    seq: int = Field(default=0, ge=0, le=2**31 - 1)
    height: float = Field(default=0.5, ge=0, le=1)
    activity: float = Field(default=0, ge=0, le=1)  # Below steering.REST is stillness.
    spread: float = Field(default=0.5, ge=0, le=1)


VARIANTS = {"spine": Spine, "free": Live}


class SteeredRenderer:
    """Own the model on one thread; each control conditions the next 40 ms frame."""

    def __init__(self, factory=None):
        self.factory = factory
        self.engine = None

    def start(self, seed, variant="spine"):
        if self.engine is None:
            self.interactive = promote_thread()
            if self.factory is None:
                from .music import MusicEngine

                self.factory = MusicEngine
            self.engine = self.factory()
            self.instruments = {name: kind(self.engine) for name, kind in VARIANTS.items()}
            # Compile before the browser starts its performance clock.
            self.engine.generate(np.zeros(128, dtype=np.int32), drumless=True)
        self.instrument = self.instruments[variant]
        self.instrument.start(seed)
        self.frames = 0
        return {"interactive": self.interactive, "variant": variant}

    def render(self, control):
        started = time.perf_counter()
        move = Move(height=control.height, activity=control.activity, spread=control.spread)
        audio = self.instrument.render(move)
        self.frames += 1
        stats = {
            "seq": control.seq,
            "frame": self.frames,
            "modelMs": round((time.perf_counter() - started) * 1000, 1),
            "weights": self.instrument.weights.round(3).tolist(),
            "gain": round(self.instrument.gain, 3),
        }
        instrument = self.instrument
        if isinstance(instrument, Spine):
            stats["pitchClasses"] = sorted(instrument.allowed(instrument.held))
            stats["chord"] = instrument.chord[0]
            stats["chords"] = [name for name, _ in instrument.progression]
            stats["bar"] = instrument.bar
            stats["beat"] = round(
                instrument.frame
                % instrument.bar_frames
                / instrument.bar_frames
                * instrument.beats_per_bar,
                2,
            )
        else:
            still = control.activity < REST
            stats["pitchClasses"] = [] if still else sorted(Steered.pitch_classes(control.spread))
        return audio.astype("<f4").tobytes(), stats

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

    def options(self, websocket):
        """`?variant=free` plays the steered design without the spine, for comparison."""
        variant = websocket.query_params.get("variant", "spine")
        return {"variant": variant if variant in VARIANTS else "spine"}


SERVICE = SteeredService()


@router.websocket("/api/steered/stream")
async def stream(websocket: WebSocket):
    await SERVICE.connect(websocket)
