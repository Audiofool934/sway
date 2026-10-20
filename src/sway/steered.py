"""The steered instrument: the hands steer the direction, and MRT2 writes every note.

docs/motion-to-music.md measured this design as "steered". Height moves the style from a
low register to a high one, activity from calm to lively, and spread opens the harmony.
By default it plays a film score that the player conducts (`piece.Piece`): V2's spine,
with phrases that a composer plans, and the conductor's gestures (docs/v2-design.md).
`?variant=spine` plays the spine of V2's first milestone, Night Drive's four chords on
repeat, and `?variant=free` the page as it was on October 14, without the spine.
"""

import asyncio
import logging
import time

import numpy as np
from fastapi import APIRouter, WebSocket
from pydantic import BaseModel, ConfigDict, Field

from .arranger import Arranger
from .harmony import assets_ready
from .piece import Gesture, Piece
from .qwen import QwenClient
from .steering import REST, Live, Move, Spine, Steered
from .stream import StreamService, promote_thread

log = logging.getLogger(__name__)
router = APIRouter()


class Control(BaseModel):
    """The page's controls: the conductor's for the film score, steering for the others."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    seq: int = Field(default=0, ge=0, le=2**31 - 1)
    # Steering, for the spine and the free variant.
    height: float = Field(default=0.5, ge=0, le=1)
    activity: float = Field(default=0, ge=0, le=1)  # Below steering.REST is stillness.
    spread: float = Field(default=0.5, ge=0, le=1)
    # The conductor's, for the film score (piece.Gesture).
    dynamics: float = Field(default=0, ge=0, le=1)
    energy: float = Field(default=0, ge=0, le=1)
    voice: float = Field(default=0.5, ge=0, le=1)
    forward: float = Field(default=0, ge=0, le=1)
    articulation: float = Field(default=0, ge=0, le=1)
    hush: bool = True
    cue: int = Field(default=0, ge=0, le=2**31 - 1)  # Times the player moved on.
    prepared: bool = False  # Both hands held up: the page's swell. The server ignores it.


VARIANTS = {"film": Piece, "spine": Spine, "free": Live}


class SteeredRenderer:
    """Own the model on one thread; each control conditions the next 40 ms frame."""

    def __init__(self, factory=None):
        self.factory = factory
        self.engine = None

    def start(self, seed, variant="film"):
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
        self.cues = 0
        return {"interactive": self.interactive, "variant": variant}

    def render(self, control):
        started = time.perf_counter()
        if isinstance(self.instrument, Piece):
            if control.cue > self.cues:
                self.instrument.cue()
            move = Gesture(
                dynamics=control.dynamics,
                energy=control.energy,
                voice=control.voice,
                forward=control.forward,
                articulation=control.articulation,
                hush=control.hush,
            )
        else:
            move = Move(height=control.height, activity=control.activity, spread=control.spread)
        self.cues = max(self.cues, control.cue)
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
            if isinstance(instrument, Piece):
                stats.update(instrument.describe())
        else:
            still = control.activity < REST
            stats["pitchClasses"] = [] if still else sorted(Steered.pitch_classes(control.spread))
        return audio.astype("<f4").tobytes(), stats

    def offer(self, ticket, plans):
        """Hand the composer's plans to the piece, on the model thread."""
        instrument = self.instrument
        return isinstance(instrument, Piece) and instrument.offer(ticket, plans)

    def idle(self, until):
        self.engine.keep_busy(until)


class SteeredService(StreamService):
    name = "steered"
    control = Control
    busy = "A steered performance is already open"

    def __init__(self, renderer=None, arranger=None):
        super().__init__(renderer or SteeredRenderer())
        # None until first needed; False when Qwen is not configured, so that the
        # world's own plans play.
        self.arranger = arranger
        self.tasks = set()

    def ready(self):
        return assets_ready()

    def _arranger(self):
        if self.arranger is None:
            try:
                self.arranger = Arranger(self.renderer.instrument.world, QwenClient())
            except (OSError, ValueError) as error:
                log.warning("No arranger, so the world's own plans play: %s", error)
                self.arranger = False
        return self.arranger or None

    def frame_done(self, stats):
        instrument = self.renderer.instrument
        request = instrument.request() if isinstance(instrument, Piece) else None
        if request is not None and self._arranger() is not None:
            task = asyncio.create_task(self._arrange(*request))
            self.tasks.add(task)
            task.add_done_callback(self.tasks.discard)

    async def _arrange(self, ticket, summary):
        plans = await self.arranger.plan(summary)
        if plans is not None:
            await self.call(self.renderer.offer, ticket, plans)

    def closed(self):
        for task in self.tasks:
            task.cancel()

    async def aclose(self):
        if self.arranger:
            await self.arranger.aclose()

    def release(self, control):
        return control.model_copy(update={"activity": 0, "hush": True})

    def options(self, websocket):
        """`?variant=spine` or `?variant=free` plays an earlier design, for comparison."""
        variant = websocket.query_params.get("variant", "film")
        return {"variant": variant if variant in VARIANTS else "film"}


SERVICE = SteeredService()


@router.websocket("/api/steered/stream")
async def stream(websocket: WebSocket):
    await SERVICE.connect(websocket)
