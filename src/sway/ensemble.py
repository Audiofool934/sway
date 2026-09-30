"""Shared musical time and Qwen's arrangement, independent of camera frame timing."""

import math

import numpy as np

from .config import PALETTE_CONTEXT
from .schema import Arrangement


def opening_arrangement(palette: str) -> Arrangement:
    """A starting ensemble while waiting for the first visual interpretation."""
    instruments = {
        "chamber": ("warm piano", "plucked strings", "soft bass"),
        "nocturne": ("felt piano", "sustained strings", "soft bass"),
        "groove": ("electric piano", "gentle drums", "warm bass"),
    }[palette]
    return Arrangement(
        parts=[
            {"instrument": instrument, "role": role, "source": "accompaniment"}
            for instrument, role in zip(instruments, ("melody", "harmony", "bass"), strict=True)
        ],
        description="An unhurried instrumental conversation with space between phrases",
        chords=[[48, 64, 67], [45, 60, 64], [41, 57, 60], [43, 59, 62]],
    )


def ensemble_prompt(palette: str, arrangement: Arrangement, bpm: float) -> str:
    # Put every instrument first: MusicCoCa has a limited text context.
    parts = "; ".join(f"{part.instrument} {part.role}" for part in arrangement.parts)
    return (
        f"Simultaneous ensemble: {parts}. Interlocking parts playing together, "
        f"steady {round(bpm)} BPM groove. {arrangement.description}. {PALETTE_CONTEXT[palette]}"
    )


class MusicalClock:
    """Advance in generated audio time; adjust at most two BPM at each four-beat bar."""

    def __init__(self, bpm: float):
        self.bpm = bpm
        self.beat = 0.0
        self.frames = 0

    def advance(self, target: float) -> bool:
        before = int(self.beat // 4)
        self.beat += self.bpm / 60 * 0.04
        boundary = int(self.beat // 4) != before
        if boundary:
            self.bpm += max(-2, min(2, target - self.bpm))
        self.frames += 1
        return boundary or self.frames == 1


class EnsemblePulse:
    """Sparse, clocked harmonic cues; MRT2 supplies the notes between them and the mix.

    No instrument lane is muted and no hand onset is forwarded as a played note.
    The pitches, harmony and cue spacing come from the current arrangement.
    """

    def __init__(self):
        self.previous_beat = -0.001
        self.active = {}
        self.cue_count = 0
        self.last_pitch = None

    def next(self, beat: float, arrangement: Arrangement) -> np.ndarray:
        notes = np.full(128, -1, dtype=np.int32)
        for pitch, until in list(self.active.items()):
            if beat >= until:
                notes[pitch] = 0
                del self.active[pitch]
            else:
                notes[pitch] = 1
        spacing = arrangement.pulse_beats
        if math.floor(beat / spacing) != math.floor(self.previous_beat / spacing):
            chord = arrangement.chords[int(beat // 4) % len(arrangement.chords)]
            pitch = chord[self.cue_count % len(chord)]
            notes[pitch] = 2
            self.active[pitch] = beat + 0.5
            self.last_pitch = pitch
            self.cue_count += 1
        self.previous_beat = beat
        return notes
