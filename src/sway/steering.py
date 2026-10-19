"""Measure how much of the music the hand steers and how much the model writes.

Scripted movements play an instrument variant from one copied model state, so that two
runs differ only in the thing being compared:

- influence: the same seed, and two different movements;
- freedom: the same movement, and different seeds.

docs/motion-to-music.md defines the measurements and records the results.
Run `uv run --locked python -m sway.steering --out <folder>` on a Mac with MRT2 installed.
"""

import argparse
import copy
import itertools
import json
import math
import time
import warnings
import wave
from dataclasses import astuple, dataclass
from pathlib import Path

import numpy as np

from .pitch import note_energy

SAMPLE_RATE = 48_000
FRAME = 0.04  # One model frame.
A_MINOR = {9, 11, 0, 2, 4, 5, 7}
FREE, SILENT = -1, 0  # Note conditioning: the model may choose, or must not play.


# Movements.


@dataclass(frozen=True)
class Move:
    """What the hands do in one frame, each from 0 to 1."""

    height: float = 0.5
    activity: float = 0.5  # How much the hands move. Nearly 0 is stillness.
    spread: float = 0.5  # The distance between the hands.


NEUTRAL = Move()


def glide(start: Move, end: Move, seconds: float, *, ramp: float = 0.3) -> list[Move]:
    """A movement from `start` to `end` over `ramp` seconds, then held, one per frame."""
    frames = round(seconds / FRAME)
    steps = max(1, round(ramp / FRAME))
    moves = []
    for i in range(frames):
        x = min(1.0, (i + 1) / steps)
        values = (a + (b - a) * x for a, b in zip(astuple(start), astuple(end), strict=True))
        moves.append(Move(*values))
    return moves


@dataclass(frozen=True)
class Test:
    """Two movements from the same moment, and what the first should do to the music."""

    name: str
    attribute: str
    a: Move
    b: Move
    sign: int  # The expected sign of attribute(a) - attribute(b).


TESTS = (
    Test("register", "register", Move(height=0.9), Move(height=0.1), +1),
    Test("density", "density", Move(activity=0.95), Move(activity=0.2), +1),
    Test("harmony", "tension", Move(spread=0.95), Move(spread=0.05), +1),
    Test("rest", "loudness", Move(activity=0.0), NEUTRAL, -1),
)


# Instrument variants. Each turns a movement into one model frame, and can be copied.

REST = 0.05  # Activity below this is stillness.
FADE_IN = 0.02  # Seconds. How fast faded output returns, as on the theremin page.
A_MINOR_TRIAD = {9, 0, 4}
A_MINOR_PENTATONIC = {9, 0, 2, 4, 7}


def _unit(x: float) -> float:
    return min(1.0, max(0.0, x))


class Styled:
    """A lead that MRT2 writes, steered through a blend of four style descriptions.

    Subclasses choose the descriptions, how a movement weighs them, and which pitches the
    model may play. As in the theremin, the style is smoothed here, and MRT2 reads it every
    `style_every` frames. With `fade` set, the output fades over about that many seconds
    to `rest_level` while the hands are still: to silence, as the theremin page does,
    unless a subclass keeps some of it.
    """

    name = ""
    corners: tuple[str, str, str, str] = ("", "", "", "")
    guidance = 1.0
    smoothing = 0.18  # The fraction of the way to a new blend in each frame.
    style_every = 5
    fade: float | None = None
    rest_level = 0.0  # The output's gain while the hands are still.

    def __init__(self, engine):
        self.engine = engine
        self.styles = np.stack([engine.style.embed(text) for text in self.corners])
        self.weights = None
        self.gain = 1.0

    def blend(self, move: Move) -> np.ndarray:
        raise NotImplementedError

    def notes(self, move: Move) -> np.ndarray:
        raise NotImplementedError

    def start(self, seed: int):
        self.engine.reset(seed)
        self.engine.style_every = self.style_every
        self.weights = self.blend(NEUTRAL)
        self.gain = 1.0
        self._style()

    def _style(self):
        embedding = self.weights @ self.styles
        self.engine.apply_style(embedding)
        self.engine.current = embedding.copy()

    def render(self, move: Move) -> np.ndarray:
        self.weights += self.smoothing * (self.blend(move) - self.weights)
        self._style()
        audio = self.engine.generate(self.notes(move), drumless=True, note_guidance=self.guidance)
        return audio if self.fade is None else self._faded(audio, move.activity < REST)

    def _faded(self, audio: np.ndarray, still: bool) -> np.ndarray:
        """`audio` with its gain moving toward `rest_level` while still, and back to 1."""
        target, seconds = (self.rest_level, self.fade) if still else (1.0, FADE_IN)
        decay = np.exp(-np.arange(1, len(audio) + 1) / (seconds * SAMPLE_RATE))
        gains = target + (self.gain - target) * decay
        self.gain = float(gains[-1])
        return audio * gains[:, None].astype(audio.dtype)

    def snapshot(self) -> dict:
        return {"engine": self.engine.snapshot(), "weights": self.weights.copy(), "gain": self.gain}

    def restore(self, snapshot: dict, seed: int):
        self.engine.restore(snapshot["engine"], seed)
        self.engine.style_every = self.style_every
        self.weights = snapshot["weights"].copy()
        self.gain = snapshot["gain"]


def _plane(x: float, y: float) -> np.ndarray:
    """Weights of four corners ordered (low x, low y), (high x, low y), (low x, high y), ..."""
    x, y = _unit(x), _unit(y)
    return np.array([(1 - x) * (1 - y), x * (1 - y), (1 - x) * y, x * y], dtype=np.float32)


class Window(Styled):
    """The first proposal: height centres a window of in-key pitches the model may play.

    Every pitch outside the window is silent. Spread moves the style from dark to bright,
    and activity from calm to lively. Measured on October 7, MRT2 did not keep to such a
    window: it obeys silenced pitch classes, not silenced octaves.
    """

    name = "window"
    corners = (
        "Gentle solo piano improvisation, slow flowing melodic lines, soft, warm and dark, "
        "instrumental",
        "Gentle solo piano improvisation, slow flowing melodic lines, soft, bright and "
        "sparkling, instrumental",
        "Energetic solo piano improvisation, fast flowing melodic runs, warm and dark, "
        "instrumental",
        "Energetic solo piano improvisation, fast flowing melodic runs, bright and sparkling, "
        "instrumental",
    )

    def __init__(self, engine, *, width=6, register=(55, 79)):
        super().__init__(engine)
        self.width = width
        self.register = register

    def blend(self, move):
        return _plane(move.spread, move.activity)

    def notes(self, move):
        tokens = np.full(128, SILENT, dtype=np.int32)
        if move.activity < REST:
            return tokens
        low, high = self.register
        centre = low + _unit(move.height) * (high - low)
        for pitch in range(36, 97):
            if pitch % 12 in A_MINOR and abs(pitch - centre) <= self.width:
                tokens[pitch] = FREE
        return tokens


class Steered(Styled):
    """The revision: each movement uses a handle that MRT2 is measured to follow.

    Height moves the style from a low register to a high one, and activity from calm to
    lively. Spread opens the harmony: the A minor triad's pitch classes when narrow, the
    pentatonic scale in between, and the whole scale when wide. Stillness silences every
    pitch. The model chooses every note within that.
    """

    name = "steered"
    corners = (
        "Gentle solo piano improvisation, slow flowing melodic lines in a low register, "
        "deep warm bass melodies, instrumental",
        "Gentle solo piano improvisation, slow flowing melodic lines in a high register, "
        "bright treble melodies, instrumental",
        "Energetic solo piano improvisation, fast flowing melodic runs in a low register, "
        "deep warm bass melodies, instrumental",
        "Energetic solo piano improvisation, fast flowing melodic runs in a high register, "
        "bright treble melodies, instrumental",
    )

    def blend(self, move):
        return _plane(move.height, move.activity)

    @staticmethod
    def pitch_classes(spread: float) -> set[int]:
        if spread < 0.35:
            return A_MINOR_TRIAD
        return A_MINOR_PENTATONIC if spread < 0.65 else A_MINOR

    def notes(self, move):
        tokens = np.full(128, SILENT, dtype=np.int32)
        if move.activity < REST:
            return tokens
        classes = self.pitch_classes(move.spread)
        for pitch in range(36, 97):
            if pitch % 12 in classes:
                tokens[pitch] = FREE
        return tokens


class Quick(Steered):
    """Steered, made faster: the blend follows the hands at once, MRT2 reads the style
    every frame, and stillness fades the output like the theremin page.
    """

    name = "quick"
    smoothing = 1.0
    style_every = 1
    fade = 0.08


class Live(Steered):
    """Steered as the page played it before the spine: `Quick`'s fade on stillness."""

    name = "free"
    fade = Quick.fade


# Night Drive's progression, as in web/instrument/theory.js, with full triads.
PROGRESSION = (("Am", (9, 0, 4)), ("F", (5, 9, 0)), ("C", (0, 4, 7)), ("G", (7, 11, 2)))


class Spine(Steered):
    """Steered on a spine, V2's first milestone (docs/v2-design.md).

    The steered page sounded like "random music pieces joined together". Here the music
    keeps a bar grid at Night Drive's 100 beats a minute and its chords, one a bar:

    - The notes MRT2 may play follow the bar's chord. Spread opens them around it: the
      chord's tones when the hands are close, the pentatonic scale in between, and the
      whole scale when they are wide.
    - The harmony runs `lead` frames ahead of the bar line, so that MRT2's delay lands
      each chord on its downbeat. Measured on October 19 over six seeds, the melody's
      share on the bar's chord, early and late in the bar, rose from 0.26 and 0.55 with
      no lead to 0.60 and 0.98 with 1.2 s; 0.8 s and 1.6 s did worse.
    - The harmony that the hands ask for takes effect where the next chord does, not on
      the next frame. The style still follows them continuously, as it changes gradually.
    - Stillness thins the music instead of stopping it: the output falls to about a third
      at once, and from the next chord only its root and fifth may sound.
    """

    name = "spine"
    # A continuous ensemble instead of solo piano. With the hands held still, solo piano
    # played in fragments: its note rate varied 34% from second to second, against 18%
    # for an ensemble and 25% for flowing arpeggios, which Everett heard as far more
    # continuous. Instruments, not register words, move the register: over six seeds on
    # October 20, height moved it in all six (effect 3.7) and activity the density in all
    # six (effect 3.8).
    corners = (
        "Calm cinematic ensemble: slow sustained cellos and double bass with soft low "
        "piano chords, warm and continuous, instrumental",
        "Calm cinematic ensemble: slow sustained high violins and soft high piano, airy, "
        "bright and continuous, instrumental",
        "Energetic cinematic ensemble: fast rhythmic low piano arpeggios and pulsing "
        "staccato cellos over a driving double bass, continuous, instrumental",
        "Energetic cinematic ensemble: fast rhythmic high piano arpeggios and pulsing "
        "staccato violins, bright and continuous, instrumental",
    )
    tempo = 100
    beats_per_bar = 4
    progression = PROGRESSION
    fade = 0.3
    rest_level = 0.35  # About -9 dB.
    lead = 30  # Frames: 1.2 s.

    def __init__(self, engine):
        super().__init__(engine)
        self.bar_frames = round(self.beats_per_bar * 60 / self.tempo / FRAME)
        self.frame = 0
        self.held = None  # The movement that the current chord's harmony follows.

    def start(self, seed: int):
        super().start(seed)
        self.frame = 0
        self.held = None

    @property
    def bar(self) -> int:
        """The bar being heard."""
        return self.frame // self.bar_frames

    @property
    def chord(self) -> tuple[str, tuple[int, ...]]:
        """The chord being heard."""
        return self.progression[self.bar % len(self.progression)]

    @property
    def harmony(self) -> tuple[str, tuple[int, ...]]:
        """The chord MRT2 is told to play now: the one `lead` frames ahead."""
        bar = (self.frame + self.lead) // self.bar_frames
        return self.progression[bar % len(self.progression)]

    def allowed(self, move: Move) -> set[int]:
        """The pitch classes MRT2 may play now, for the movement it follows."""
        tones = set(self.harmony[1])
        if move.activity < REST:
            root = self.harmony[1][0]
            return {root, (root + 7) % 12}
        if move.spread < 0.35:
            return tones
        return tones | (A_MINOR_PENTATONIC if move.spread < 0.65 else A_MINOR)

    def notes(self, move):
        if self.held is None or (self.frame + self.lead) % self.bar_frames == 0:
            self.held = move
        tokens = np.full(128, SILENT, dtype=np.int32)
        classes = self.allowed(self.held)
        for pitch in range(36, 97):
            if pitch % 12 in classes:
                tokens[pitch] = FREE
        return tokens

    def render(self, move: Move) -> np.ndarray:
        audio = super().render(move)
        self.frame += 1
        return audio

    def snapshot(self) -> dict:
        return {**super().snapshot(), "frame": self.frame, "held": self.held}

    def restore(self, snapshot: dict, seed: int):
        super().restore(snapshot, seed)
        self.frame = snapshot["frame"]
        self.held = snapshot["held"]


# theremin-controls.js's pitch steps.
THEREMIN_PITCHES = (48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72, 74, 76)


class ThereminHand:
    """theremin-controls.js's mapping from hands to controls, for a scripted movement.

    Height picks a pitch step with the same hysteresis, spread is smoothed the same way,
    and energy follows activity and decays after stillness. Activity above one half stands
    for short back-and-forth strokes: up to four a second, each an accent that builds
    articulation.
    """

    def __init__(self):
        self.index = 5
        self.spread = 0.3
        self.grain = 0.0
        self.energy = 0.0
        self.accent = 0
        self.seq = 0
        self.time = 0.0
        self.last_motion = 0.0
        self.last_accent = -1.0
        self.next_stroke = 0.0

    def update(self, move: Move):
        from .theremin import Control

        dt = FRAME
        self.time += dt
        position = min(1, max(0, move.height)) * (len(THEREMIN_PITCHES) - 1)
        if abs(position - self.index) > 0.7:
            self.index = round(position)
        self.spread += (min(1, max(0, move.spread)) - self.spread) * (1 - math.exp(-dt / 0.15))
        if move.activity >= REST:
            self.last_motion = self.time
        strokes = 4 * min(1, max(0, (move.activity - 0.5) / 0.5))
        if strokes and self.time >= self.next_stroke and self.time - self.last_accent > 0.18:
            self.accent += 1
            self.grain = min(1.0, self.grain + 0.48)
            self.last_accent = self.time
            self.next_stroke = self.time + 1 / strokes
        self.grain *= math.exp(-dt / 1.5)
        still = max(0.0, self.time - self.last_motion - 0.65)
        target = (0.42 + 0.5 * min(1, max(0, move.activity))) * math.exp(-still / 0.5)
        rate = 0.055 if target > self.energy else 0.18
        self.energy += (target - self.energy) * (1 - math.exp(-dt / rate))
        self.seq += 1
        return Control(
            seq=self.seq,
            pitch=THEREMIN_PITCHES[self.index],
            spread=self.spread,
            grain=self.grain,
            energy=self.energy,
            active=self.energy > 0.025,
            accent=self.accent,
        )


class Theremin:
    """Today's theremin: its own renderer, driven through ThereminHand."""

    name = "theremin"
    _renderer_fields = ("weights", "held", "last_accent", "last_strike", "frames")

    def __init__(self, engine):
        from .theremin import ThereminRenderer

        self.engine = engine
        self.renderer = ThereminRenderer(factory=lambda: engine)
        self.hand = ThereminHand()

    def start(self, seed: int):
        self.renderer.start(seed)
        self.hand = ThereminHand()

    def render(self, move: Move) -> np.ndarray:
        audio, _ = self.renderer.render(self.hand.update(move))
        return np.frombuffer(audio, dtype="<f4").reshape(-1, 2)

    def snapshot(self) -> dict:
        fields = {
            name: copy.deepcopy(getattr(self.renderer, name)) for name in self._renderer_fields
        }
        return {
            "engine": self.engine.snapshot(),
            "renderer": fields,
            "hand": copy.deepcopy(self.hand),
        }

    def restore(self, snapshot: dict, seed: int):
        self.engine.restore(snapshot["engine"], seed)
        for name, value in snapshot["renderer"].items():
            setattr(self.renderer, name, copy.deepcopy(value))
        self.hand = copy.deepcopy(snapshot["hand"])


# Features of the audio, in short overlapping windows.

WINDOW = 0.25  # Seconds.
HOP = 0.05
SILENCE = -55.0  # dBFS. Quieter windows have no register, brightness, tension, or notes.
SPAN = 1.0  # Seconds of music whose notes are compared at once.
FLOOR = -90.0  # dBFS. Loudness stops here, so silence does not dominate averages.


def flux(mono: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Spectral flux every 10 ms: how much the spectrum grows, a measure of new sound.

    Counting onset peaks undercounts fast runs, whose flux stays high between notes, so
    the busyness of a line is the flux itself. Returns the times and the values.
    """
    size, step = 1024, 480
    if len(mono) < size:
        return np.zeros(0), np.zeros(0)
    count = 1 + (len(mono) - size) // step
    frames = np.stack([mono[i * step : i * step + size] for i in range(count)])
    magnitude = np.log1p(100 * np.abs(np.fft.rfft(frames * np.hanning(size), axis=1)))
    values = np.concatenate([[0.0], np.maximum(0, np.diff(magnitude, axis=0)).sum(axis=1)])
    times = (np.arange(count) * step + size / 2) / SAMPLE_RATE
    return times, values


def features(audio: np.ndarray) -> dict:
    """Per window: loudness, brightness, register, tension, density, and notes.

    - loudness: dBFS, stopping at FLOOR;
    - brightness: the spectral centroid, in octaves above 440 Hz;
    - register: the energy-weighted mean MIDI pitch of the notes found;
    - tension: the share of the notes' energy off the A minor triad's pitch classes;
    - density: the mean spectral flux within half a second either side;
    - notes: each pitch class's share of the notes' energy over a one-second span, so
      that an octave mistaken by the analysis or a note played slightly later still
      counts as the same note.
    """
    mono = np.asarray(audio, dtype=np.float64).mean(axis=1)
    size, step = round(WINDOW * SAMPLE_RATE), round(HOP * SAMPLE_RATE)
    count = 1 + (len(mono) - size) // step
    flux_times, flux_values = flux(mono)
    names = ("loudness", "brightness", "register", "tension")
    result = {name: np.full(count, np.nan) for name in names}
    result["density"] = np.zeros(count)
    result["time"] = np.arange(count) * HOP + WINDOW / 2
    classes = np.zeros((count, 12))
    freqs = np.fft.rfftfreq(size, 1 / SAMPLE_RATE)
    triad = np.isin(np.arange(12), list(A_MINOR_TRIAD))
    for i in range(count):
        chunk = mono[i * step : i * step + size]
        level = max(FLOOR, 20 * np.log10(np.sqrt(np.mean(chunk**2)) + 1e-12))
        result["loudness"][i] = level
        near = np.abs(flux_times - result["time"][i]) <= 0.5
        result["density"][i] = float(flux_values[near].mean()) if near.any() else 0.0
        if level < SILENCE:
            continue
        power = np.abs(np.fft.rfft(chunk * np.hanning(size))) ** 2
        if power.sum() <= 0:
            continue
        result["brightness"][i] = math.log2(float((freqs * power).sum() / power.sum()) / 440)
        energy = note_energy(chunk, SAMPLE_RATE, low=36, high=96)
        if energy.sum() > 0:
            share = energy / energy.sum()
            result["register"][i] = float((np.arange(128) * share).sum())
            # Raw energy, so that a quiet window weighs less than a loud one over the span.
            classes[i] = np.bincount(np.arange(128) % 12, weights=energy, minlength=12)
            result["tension"][i] = 1 - float(classes[i][triad].sum() / classes[i].sum())
    reach = round(SPAN / 2 / HOP)
    result["notes"] = np.full((count, 12), np.nan)
    for i in range(count):
        total = classes[max(0, i - reach) : i + reach + 1].sum(axis=0)
        if total.sum() > 0:
            result["notes"][i] = total / total.sum()
    return result


def difference(attribute: str, x: dict, y: dict) -> np.ndarray:
    """Per window, how far apart two runs are in one attribute."""
    if attribute == "notes":
        # Half the L1 distance between pitch-class shares: 0 is the same, 1 none in common.
        return 0.5 * np.abs(x["notes"] - y["notes"]).sum(axis=1)
    return np.abs(x[attribute] - y[attribute])


# Measurements.

SETTLE = 1.0  # Seconds after the movement starts before averages begin.
ATTRIBUTES = ("register", "density", "tension", "brightness", "loudness", "notes")


def measure(test: Test, runs: dict) -> dict:
    """The measurements for one test from `runs[seed] = {"a": features, "b": features}`.

    - influence: the mean difference between a and b with the same seed;
    - freedom: the mean difference between seeds for the same movement;
    - share: influence / (influence + freedom), how much of the variation is the hand's;
    - consistency: the fraction of seeds in which a moves the test's attribute the
      expected way;
    - effect: that movement in units of the seeds' spread;
    - response: the first time at which the median movement exceeds the seeds' spread
      for 0.15 s, or None;
    - half: the first time at which the median movement reaches half its settled size
      for 0.15 s, or None.
    """
    with warnings.catch_warnings(action="ignore", category=RuntimeWarning):
        return _measure(test, runs)


def _measure(test, runs):
    seeds = sorted(runs)
    late = runs[seeds[0]]["a"]["time"] >= SETTLE
    result = {"attributes": {}}
    for attribute in ATTRIBUTES:
        influence = [
            np.nanmean(difference(attribute, runs[k]["a"], runs[k]["b"])[late]) for k in seeds
        ]
        freedom = [
            np.nanmean(difference(attribute, runs[j][side], runs[k][side])[late])
            for j, k in itertools.combinations(seeds, 2)
            for side in ("a", "b")
        ]
        i, f = _mean(influence), _mean(freedom)
        share = None if i is None or f is None or i + f == 0 else i / (i + f)
        result["attributes"][attribute] = {"influence": i, "freedom": f, "share": share}

    name, sign = test.attribute, test.sign
    a = np.array([runs[k]["a"][name] for k in seeds])
    b = np.array([runs[k]["b"][name] for k in seeds])
    effects = sign * (np.nanmean(a[:, late], axis=1) - np.nanmean(b[:, late], axis=1))
    spread = np.nanmean([np.nanstd(np.nanmean(x[:, late], axis=1)) for x in (a, b)])
    moved = sign * np.nanmedian(a - b, axis=0)
    noise = np.nanmean([np.nanstd(a, axis=0), np.nanstd(b, axis=0)], axis=0)
    valid = effects[np.isfinite(effects)]
    result["consistency"] = float(np.mean(valid > 0)) if len(valid) else None
    result["effect"] = float(np.mean(valid) / spread) if len(valid) and spread > 0 else None
    times = runs[seeds[0]]["a"]["time"]
    result["response"] = _response(times, moved, noise)
    result["half"] = _half(times, moved, late)
    return result


def _half(times, moved, late, hold=0.15):
    """When the median movement first reaches half its settled size, for `hold` seconds."""
    settled = np.nanmedian(moved[late])
    if not np.isfinite(settled) or settled <= 0:
        return None
    return _response(times, moved, np.full_like(moved, settled / 2), hold)


def _response(times, moved, noise, hold=0.15):
    above = np.nan_to_num(moved) > np.nan_to_num(noise, nan=np.inf)
    needed = max(1, round(hold / HOP))
    for i in range(len(above) - needed + 1):
        if above[i : i + needed].all():
            return float(times[i])
    return None


def _mean(values):
    finite = [v for v in values if np.isfinite(v)]
    return float(np.mean(finite)) if finite else None


# Running.


def run_variant(variant, *, seeds, tests=TESTS, context_seed=1, warmup=6.0, length=6.0, keep=None):
    """Play each test from one moment of music, in both movements, once per seed.

    `keep(test, seed, side, audio)` receives the audio of each run, preceded by the last
    three seconds of the shared warm-up.
    """
    variant.start(context_seed)
    warm = np.concatenate([variant.render(move) for move in glide(NEUTRAL, NEUTRAL, warmup)])
    context = warm[-3 * SAMPLE_RATE :]
    moment = variant.snapshot()
    results = {}
    for test in tests:
        runs = {}
        for seed in seeds:
            runs[seed] = {}
            for side, target in (("a", test.a), ("b", test.b)):
                variant.restore(moment, seed)
                audio = np.concatenate([variant.render(m) for m in glide(NEUTRAL, target, length)])
                runs[seed][side] = features(audio)
                if keep:
                    keep(test, seed, side, np.concatenate([context, audio]))
        results[test.name] = measure(test, runs)
    return results


def write_wav(path: Path, audio: np.ndarray):
    pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)
        output.writeframes(pcm.tobytes())


QUESTIONS = {
    "register": "In which clip does the hand rise?",
    "density": "In which clip do the hands move a lot?",
    "harmony": "In which clip do the hands spread wide?",
    "rest": "In which clip are the hands held still?",
}

# The same choices, asked about the sound, to tell an inaudible change from a movement
# that does not suggest it.
SOUND_QUESTIONS = {
    "register": "In which clip does the music move higher?",
    "density": "In which clip are there more notes?",
    "harmony": "In which clip does the melody sound more tense, with notes beyond the chord?",
    "rest": "In which clip does the music go quiet?",
}


def listening_page(out: Path, variants, seeds, tests=TESTS, questions=QUESTIONS):
    """A blind test page: for each pair, which clip matches the question?

    The clips are the kept runs of `variants` for `seeds`. The order of the pairs and of
    the clips within them is shuffled, with a fixed seed so the page is reproducible.
    """
    rng = np.random.default_rng(0)
    trials = []
    for variant in variants:
        for test in tests:
            for seed in seeds:
                clips = [f"{variant}/{test.name}-{side}-seed{seed}.wav" for side in "ab"]
                flip = bool(rng.integers(2))
                x, y = clips[::-1] if flip else clips
                trials.append(
                    {
                        "variant": variant,
                        "test": test.name,
                        "seed": seed,
                        "question": questions[test.name],
                        "x": x,
                        "y": y,
                        "answer": "y" if flip else "x",
                    }
                )
    order = rng.permutation(len(trials))
    trials = [dict(trials[i], id=n) for n, i in enumerate(order)]
    write_page(out, trials, start=3)


def write_page(out: Path, trials, *, start=None, preference=False):
    """The listening page for `trials`, with the movement's mark at `start` seconds.

    A preference test has no right answer: each trial's `answer` is the clip whose
    choices it counts, and the page does not say right or wrong.
    """
    template = (Path(__file__).with_name("listening_test.html")).read_text()
    page = (
        template.replace("__TRIALS__", json.dumps(trials))
        .replace("__START__", json.dumps(start))
        .replace("__PREFERENCE__", json.dumps(preference))
    )
    (out / "listening-test.html").write_text(page)


# A 40-second performance that steers, rests, and starts again: what made the steered
# page sound like "random music pieces joined together".
PERFORMANCE = (
    (8.0, Move(height=0.25, activity=0.35, spread=0.1)),
    (8.0, Move(height=0.8, activity=0.9, spread=0.9)),
    (4.0, Move(height=0.5, activity=0.0, spread=0.5)),
    (8.0, Move(height=0.5, activity=0.55, spread=0.5)),
    (4.0, Move(height=0.5, activity=0.0, spread=0.5)),
    (8.0, Move(height=0.2, activity=0.8, spread=0.2)),
)


def perform(variant, seed: int, *, warmup=4.0, script=PERFORMANCE) -> np.ndarray:
    """`script` played from a fresh stream, after `warmup` seconds that are not kept."""
    variant.start(seed)
    for move in glide(NEUTRAL, NEUTRAL, warmup):
        variant.render(move)
    moves, previous = [], NEUTRAL
    for seconds, move in script:
        moves += glide(previous, move, seconds)
        previous = move
    return np.concatenate([variant.render(move) for move in moves])


def silence(audio: np.ndarray) -> float:
    """The share of 250 ms windows quieter than `SILENCE`."""
    window = round(WINDOW * SAMPLE_RATE)
    mono = audio.mean(axis=1)
    count = len(mono) // window
    rms = np.sqrt(np.mean(mono[: count * window].reshape(count, window) ** 2, axis=1))
    return float(np.mean(20 * np.log10(np.maximum(rms, 1e-12)) < SILENCE))


def continuity(out: Path, engine, seeds):
    """Clips of the performance with and without the spine, and a page to compare them.

    The page asks which clip of each pair sounds more like one continuous piece, and
    counts how often the spine's is chosen.
    """
    rng = np.random.default_rng(0)
    trials, quiet = [], {"free": [], "spine": []}
    for seed in seeds:
        for kind in (Live, Spine):
            audio = perform(kind(engine), seed)
            quiet[kind.name].append(silence(audio))
            write_wav(out / f"{kind.name}-seed{seed}.wav", audio)
        clips = [f"spine-seed{seed}.wav", f"free-seed{seed}.wav"]
        flip = bool(rng.integers(2))
        x, y = clips[::-1] if flip else clips
        trials.append(
            {
                "variant": "spine",
                "test": "continuity",
                "seed": seed,
                "question": "Which clip sounds more like one continuous piece of music?",
                "x": x,
                "y": y,
                "answer": "y" if flip else "x",
            }
        )
    order = rng.permutation(len(trials))
    write_page(out, [dict(trials[i], id=n) for n, i in enumerate(order)], preference=True)
    return {name: float(np.mean(values)) for name, values in quiet.items()}


def summary(results: dict) -> str:
    """A Markdown table per variant."""
    lines = []
    for variant, tests in results.items():
        lines += [f"### {variant}", ""]
        lines.append("| Test | Share | Consistency | Effect | Response | Half | Note freedom |")
        lines.append("| --- | --- | --- | --- | --- | --- | --- |")
        for name, test in tests.items():
            attribute = next(t.attribute for t in TESTS if t.name == name)
            own = test["attributes"][attribute]
            notes = test["attributes"]["notes"]["freedom"]
            lines.append(
                f"| {name} | {_fmt(own['share'], '.2f')} | {_fmt(test['consistency'], '.0%')} "
                f"| {_fmt(test['effect'], '.1f')} | {_fmt(test['response'], '.2f', ' s')} "
                f"| {_fmt(test['half'], '.2f', ' s')} "
                f"| {_fmt(notes, '.2f')} |"
            )
        lines.append("")
    return "\n".join(lines)


def _fmt(value, spec, suffix=""):
    return (
        "never" if value is None and suffix else "-" if value is None else f"{value:{spec}}{suffix}"
    )


def main():
    parser = argparse.ArgumentParser(description="Measure steering and freedom with MRT2")
    parser.add_argument("--out", required=True, help="A new folder for results and audio")
    parser.add_argument("--seeds", type=int, default=8)
    parser.add_argument("--variants", default="theremin,window,steered")
    parser.add_argument("--keep-audio", type=int, default=2, help="Seeds whose audio is saved")
    parser.add_argument("--tests", default=",".join(test.name for test in TESTS))
    parser.add_argument(
        "--continuity",
        action="store_true",
        help="Compare the performance with and without the spine, instead of measuring",
    )
    parser.add_argument(
        "--ask",
        choices=("movement", "sound"),
        default="movement",
        help="Whether the listening test asks about the movement or the sound",
    )
    args = parser.parse_args()
    out = Path(args.out).expanduser().resolve()
    out.mkdir(parents=True, exist_ok=False)
    from .music import MusicEngine

    engine = MusicEngine()
    if args.continuity:
        seeds = list(range(100, 100 + args.seeds))
        quiet = continuity(out, engine, seeds)
        print(f"Silent share of each clip: {quiet}")
        (out / "silence.json").write_text(json.dumps(quiet, indent=2) + "\n")
        return
    makers = {
        "theremin": lambda: Theremin(engine),
        "window": lambda: Window(engine),
        "steered": lambda: Steered(engine),
        "quick": lambda: Quick(engine),
        "spine": lambda: Spine(engine),
    }
    seeds = list(range(100, 100 + args.seeds))
    tests = [next(t for t in TESTS if t.name == name) for name in args.tests.split(",")]
    results = {}
    for name in args.variants.split(","):
        started = time.monotonic()
        audio_dir = out / name
        audio_dir.mkdir()

        def keep(test, seed, side, audio, audio_dir=audio_dir):
            if seed < seeds[0] + args.keep_audio:
                write_wav(audio_dir / f"{test.name}-{side}-seed{seed}.wav", audio)

        results[name] = run_variant(makers[name](), seeds=seeds, tests=tests, keep=keep)
        print(f"{name}: {time.monotonic() - started:.0f} s", flush=True)
    (out / "results.json").write_text(json.dumps(results, indent=2) + "\n")
    questions = SOUND_QUESTIONS if args.ask == "sound" else QUESTIONS
    listening_page(out, list(results), seeds[: args.keep_audio], tests, questions)
    table = summary(results)
    (out / "summary.md").write_text(table + "\n")
    print(table)


if __name__ == "__main__":
    main()
