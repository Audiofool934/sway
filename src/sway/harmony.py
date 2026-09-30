"""Generated harmony for the V1 instrument: MRT2 renders the band's chords bar by bar.

The browser's scheduler owns the beat grid and chooses every chord. This module only turns
one bar's chord into audio: pitch classes outside the chord are silenced in every octave,
the voicing is played, and the model supplies the sound of the chosen palette. Bars render
in order from one model state, so each bar continues the last without a seam.
"""

import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np

from .config import MRT_DIR, MRT_FILES

SAMPLE_RATE = 48_000
FRAME_SAMPLES = 1920  # One model frame: 40 ms at 48 kHz.
FRAME_SECONDS = FRAME_SAMPLES / SAMPLE_RATE

# Pad-like prompts. Each kept 97 to 100% of its energy on the given chords' scale when
# measured; rhythmic prompts such as "downtempo electric piano" drifted out of key.
PALETTES = {
    "strings": "Lush warm string ensemble pad, slow attack, ambient, instrumental",
    "piano": "Soft felt piano chords, gentle, intimate, instrumental",
    "choir": "Airy ethereal choir pad, soft voices, ambient",
}

# Conditioning tokens per MIDI pitch, as the exported MRT2 graph reads them.
FREE, SILENT, HELD, STRUCK = -1, 0, 1, 2


def assets_ready(model_dir=MRT_DIR) -> bool:
    return all((model_dir / name).is_file() for name in MRT_FILES)


def frames_per_bar(tempo: float, beats_per_bar: int) -> int:
    """Model frames in one bar. Bars must be whole frames so they join exactly on the grid."""
    frames = beats_per_bar * 60 / tempo / FRAME_SECONDS
    whole = round(frames)
    if whole < 1 or abs(frames - whole) > 1e-6:
        raise ValueError("A bar must last a whole number of 40 ms model frames")
    return whole


def bar_tokens(notes, tones, frames, beat_frames) -> np.ndarray:
    """Note conditioning for one bar, one row per model frame.

    Pitch classes outside the chord and the bar's notes are silent in every octave, so
    nothing can sound out of key. Each note is struck on its first frame, unless it is tied
    over from the last bar, and held to its end; a written pitch is silent where no note
    is written, so lines are articulated as written. Other octaves of the chord's pitch
    classes stay free for the model's own doublings.
    """
    tokens = np.full((frames, 128), FREE, dtype=np.int32)
    allowed = {tone % 12 for tone in tones} | {note.pitch % 12 for note in notes}
    for pitch in range(128):
        if pitch % 12 not in allowed:
            tokens[:, pitch] = SILENT
    for pitch in {note.pitch for note in notes}:
        tokens[:, pitch] = SILENT
    for note in notes:
        first = min(frames - 1, round(note.start * beat_frames))
        last = min(frames, max(first + 1, round((note.start + note.length) * beat_frames)))
        tokens[first:last, note.pitch] = HELD
        if not note.tie:
            tokens[first, note.pitch] = STRUCK
    return tokens


def to_pcm(audio: np.ndarray) -> bytes:
    """Interleaved 16-bit little-endian PCM."""
    return (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()


class StaleStream(Exception):
    """A bar was requested for a piece that has since been replaced."""


class HarmonyRenderer:
    """One continuous MRT2 stream. Use it from a single thread, such as `EXECUTOR`."""

    def __init__(self, engine_factory=None):
        self._factory = engine_factory
        self.engine = None
        self.palette = None
        self.frame_ms = []
        # The piece whose bars are wanted. Set when a start request arrives, before it
        # queues, so bars still queued for a replaced piece are skipped, not rendered.
        self.stream = None

    @property
    def loaded(self) -> bool:
        return self.engine is not None

    def _load(self):
        if self.engine is None:
            if self._factory is None:
                from .music import MusicEngine

                self._factory = MusicEngine
            self.engine = self._factory()
        return self.engine

    def _style(self, palette, *, immediate):
        engine = self.engine
        embedding = engine.style.embed(PALETTES[palette])
        engine.apply_style(embedding)
        if immediate:
            engine.current = embedding.copy()
            engine.style_tokens = engine.style.tokens(engine.current)
        self.palette = palette

    def start(self, palette: str, seed: int) -> dict:
        """Begin a new piece: a fresh stream in `palette`, with the graph already compiled.

        A new seed per piece keeps the model's choices, and so the pieces, from repeating.
        """
        started = time.perf_counter()
        engine = self._load()
        self._style(palette, immediate=True)
        # The first call compiles the graph; do it before the piece needs a bar in time.
        engine.generate(np.full(128, SILENT, dtype=np.int32), drumless=True)
        engine.reset(seed)
        return {"palette": palette, "ms": round((time.perf_counter() - started) * 1000)}

    def render(self, notes, tones, palette: str, frames: int, beats_per_bar: int) -> np.ndarray:
        """One bar of stereo audio playing `notes` over the chord, continuing the stream."""
        engine = self._load()
        if palette != self.palette:
            # A palette change blends over a few frames instead of switching abruptly.
            self._style(palette, immediate=self.palette is None)
        tokens = bar_tokens(notes, tones, frames, frames / beats_per_bar)
        chunks = []
        for row in tokens:
            started = time.perf_counter()
            chunks.append(engine.generate(row, drumless=True))
            self.frame_ms.append((time.perf_counter() - started) * 1000)
        self.frame_ms = self.frame_ms[-600:]
        return np.concatenate(chunks)

    def status(self) -> dict:
        recent = self.frame_ms[-120:]
        return {
            "loaded": self.loaded,
            "palette": self.palette,
            "frame_ms": round(float(np.median(recent)), 1) if recent else None,
        }


# MLX work stays on one thread, and requests render in the order they arrive.
EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="sway-harmony")
RENDERER = HarmonyRenderer()
