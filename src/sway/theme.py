"""Does a theme that MRT2 is given as notes make the spine sound like one piece?

On October 20 the conductor went "back to being isolated musical snippets without any
real subjectivity or consistency". Nothing in Sway holds a theme: MRT2 hears about 20 s
of its own past, and nothing it is given names a melody. This test gives the spine a
four-bar theme as notes, which leaves and returns, and asks blind which of two clips
sounds more like one piece with its own identity: the spine with the theme, or without
it. Both clips play the same movement from the same moment with the same random choices.

docs/steered-page.md#the-theme-test records the results.
Run `uv run --locked python -m sway.theme --out <new folder>` on a Mac with MRT2 installed.
`--calibrate` first measures how early, and how strongly, MRT2 must be told the theme.
"""

import argparse
import json
from pathlib import Path

import numpy as np

from .pitch import note_energy
from .steering import (
    FRAME,
    HELD,
    SAMPLE_RATE,
    SILENT,
    STRUCK,
    Move,
    Spine,
    glide,
    silence,
    write_page,
    write_wav,
)

MELODY = 60  # From middle C up, the theme is the only note MRT2 may play.

# Four bars over Night Drive's Am, F, C, and G, as (pitch, beats): a climb that steps
# back, a long note, the climb again from lower, and a long B.
THEME = (
    ((69, 1), (72, 1), (76, 1), (74, 1)),
    ((72, 3), (69, 1)),
    ((67, 1), (72, 1), (76, 1), (74, 1)),
    ((71, 4),),
)

# The kept bars: the theme, eight bars away, the theme, four away, and the theme.
FORM = (True,) * 4 + (False,) * 8 + (True,) * 4 + (False,) * 4 + (True,) * 4
WARMUP_BARS = 4  # Not kept, so the kept music starts on Am.

# The movement in both clips, eight bars each: moderate, livelier, then calmer. It never
# rests, so that only the theme differs.
SCRIPT = (
    (8, Move(height=0.55, activity=0.55, spread=0.4)),
    (8, Move(height=0.7, activity=0.8, spread=0.6)),
    (8, Move(height=0.4, activity=0.4, spread=0.3)),
)

EARLY = 0.3  # Seconds. The start of a note, measured apart from the rest of it.
LISTENING = -20.0  # dBFS RMS. Both clips of a pair are brought here for listening.
PEAK = -1.0  # dBFS. Unless a peak would pass this; then both are lowered alike.


class Themed(Spine):
    """The spine, with the theme in the bars that `form` marks, from bar `start`.

    In those bars every pitch from middle C up is silent except the theme's note, which
    is struck on its first frame and held after, so the theme is the top line. Below
    middle C the spine's harmony stays free, and MRT2 accompanies. MRT2 is told each
    note `ahead` frames early, with note guidance `strength`; `calibrate` chooses both.
    """

    name = "theme"
    ahead = 5
    strength = 3.0

    def __init__(self, engine, form=(), *, start=WARMUP_BARS, ahead=ahead, strength=strength):
        super().__init__(engine)
        self.ahead, self.strength = ahead, strength
        self.line = []  # One statement of the theme: (pitch, struck) for each frame.
        frames_per_beat = self.bar_frames // self.beats_per_bar
        for bar in THEME:
            for pitch, beats in bar:
                self.line += [(pitch, True)] + [(pitch, False)] * (beats * frames_per_beat - 1)
        if len(self.line) != len(THEME) * self.bar_frames:
            raise ValueError("Each bar of the theme must fill its bar")
        self.start_bar = start
        self.form = form

    @property
    def form(self) -> tuple[bool, ...]:
        return self._form

    @form.setter
    def form(self, form):
        form = tuple(form)
        blocks = len(THEME)
        if len(form) % blocks or any(
            len(set(form[i : i + blocks])) > 1 for i in range(0, len(form), blocks)
        ):
            raise ValueError("The theme plays in whole statements of four bars")
        if self.start_bar % len(self.progression):
            raise ValueError("The kept bars must start where the progression does")
        self._form = form

    def theme_at(self, frame: int) -> tuple[int, bool] | None:
        """The theme's note at `frame`, and whether it is struck there, or None."""
        bar = frame // self.bar_frames - self.start_bar
        if not 0 <= bar < len(self.form) or not self.form[bar]:
            return None
        return self.line[bar % len(THEME) * self.bar_frames + frame % self.bar_frames]

    def notes(self, move):
        tokens = super().notes(move)
        note = self.theme_at(self.frame + self.ahead)
        if note is not None:
            pitch, struck = note
            tokens[MELODY:] = SILENT
            tokens[pitch] = STRUCK if struck else HELD
        return tokens

    def render(self, move: Move) -> np.ndarray:
        theme = self.theme_at(self.frame + self.ahead) is not None
        self.guidance = self.strength if theme else Spine.guidance
        return super().render(move)


def theme_notes(form, tempo=Spine.tempo, beats_per_bar=Spine.beats_per_bar):
    """The theme's notes in the kept bars of `form`: (start, length, pitch), in seconds."""
    beat = 60 / tempo
    notes = []
    for bar, on in enumerate(form):
        if not on:
            continue
        at = bar * beats_per_bar
        for pitch, beats in THEME[bar % len(THEME)]:
            notes.append((at * beat, beats * beat, pitch))
            at += beats
    return notes


def melody_share(audio: np.ndarray, pitch: int) -> float | None:
    """The share of the energy from middle C up on `pitch`'s pitch class, or None."""
    energy = note_energy(audio, SAMPLE_RATE, high=96)
    melody = energy[MELODY:]
    total = float(melody.sum())
    if total <= 0:
        return None
    on = (np.arange(MELODY, len(energy)) % 12) == pitch % 12
    return float(melody[on].sum() / total)


def on_theme(audio: np.ndarray, notes) -> dict:
    """How much of the melody falls on each theme note, early in the note and after."""
    shares = {"early": [], "late": []}
    for start, length, pitch in notes:
        for part, (a, b) in (
            ("early", (start, start + EARLY)),
            ("late", (start + EARLY, start + length)),
        ):
            share = melody_share(audio[round(a * SAMPLE_RATE) : round(b * SAMPLE_RATE)], pitch)
            if share is not None:
                shares[part].append(share)
    return {part: _mean(values) for part, values in shares.items()}


def _mean(values):
    return float(np.mean(values)) if values else None


def rms_db(audio: np.ndarray) -> float:
    return float(20 * np.log10(max(np.sqrt(np.mean(audio**2)), 1e-12)))


def matched(*clips: np.ndarray) -> list[np.ndarray]:
    """`clips` at the same RMS level, by constant gain, with every peak below `PEAK`."""
    gains = [10 ** ((LISTENING - rms_db(clip)) / 20) for clip in clips]
    loudest = max(
        float(np.max(np.abs(clip))) * gain for clip, gain in zip(clips, gains, strict=True)
    )
    lower = min(1.0, 10 ** (PEAK / 20) / loudest) if loudest > 0 else 1.0
    return [clip * gain * lower for clip, gain in zip(clips, gains, strict=True)]


class Takes:
    """Clips that branch from one moment of a seed's stream, after the warmup."""

    def __init__(self, engine):
        self.variant = Themed(engine)
        self.moments = {}

    def play(self, seed: int, form, *, ahead=Themed.ahead, strength=Themed.strength, script=SCRIPT):
        variant = self.variant
        if seed not in self.moments:
            variant.form = ()
            variant.start(seed)
            for move in glide(script[0][1], script[0][1], WARMUP_BARS * variant.bar_frames * FRAME):
                variant.render(move)
            self.moments[seed] = variant.snapshot()
        variant.restore(self.moments[seed], seed)
        variant.form = form
        variant.ahead, variant.strength = ahead, strength
        moves, previous = [], script[0][1]
        for bars, move in script:
            moves += glide(previous, move, bars * variant.bar_frames * FRAME)
            previous = move
        return np.concatenate(
            [variant.render(move) for move in moves[: len(form) * variant.bar_frames]]
        )


# Calibration: one statement of the theme from the warmup's moment, told earlier or
# later and more or less strongly, against the same bars without it.
STATEMENT = (True,) * len(THEME)


def calibrate(engine, seeds, aheads=(0, 3, 6, 10), strengths=(1.0, 3.0)) -> list[dict]:
    takes = Takes(engine)
    notes = theme_notes(STATEMENT)
    script = ((len(THEME), SCRIPT[0][1]),)
    rows = []
    arms = [(None, None)] + [(a, s) for s in strengths for a in aheads]
    for ahead, strength in arms:
        form = (False,) * len(THEME) if ahead is None else STATEMENT
        kwargs = {} if ahead is None else {"ahead": ahead, "strength": strength}
        results = [
            on_theme(takes.play(seed, form, script=script, **kwargs), notes) for seed in seeds
        ]
        rows.append(
            {
                "ahead": None if ahead is None else ahead * FRAME,
                "strength": strength,
                "early": _mean([r["early"] for r in results if r["early"] is not None]),
                "late": _mean([r["late"] for r in results if r["late"] is not None]),
            }
        )
    return rows


def run(out: Path, engine, seeds, *, ahead=Themed.ahead, strength=Themed.strength) -> dict:
    """The clips with and without the theme, their measures, and a page to compare them."""
    takes = Takes(engine)
    notes = theme_notes(FORM)
    rng = np.random.default_rng(0)
    (out / "raw").mkdir()
    pairs, measures = [], {}
    for seed in seeds:
        clips = {
            "theme": takes.play(seed, FORM, ahead=ahead, strength=strength),
            "free": takes.play(seed, (False,) * len(FORM), ahead=ahead, strength=strength),
        }
        for name, audio in zip(clips, matched(*clips.values()), strict=True):
            write_wav(out / "raw" / f"{name}-seed{seed}.wav", clips[name])
            write_wav(out / f"{name}-seed{seed}.wav", audio)
            measures[f"{name}-seed{seed}"] = {
                **on_theme(clips[name], notes),
                "silent": silence(clips[name]),
                "level": rms_db(clips[name]),
            }
        x, y = f"theme-seed{seed}.wav", f"free-seed{seed}.wav"
        flip = bool(rng.integers(2))
        pairs.append(
            {
                "seed": seed,
                "x": y if flip else x,
                "y": x if flip else y,
                "answer": "y" if flip else "x",
            }
        )
    trials = []
    for i in rng.permutation(len(pairs)):
        pair = pairs[i]
        for test, question, again in QUESTIONS:
            trials.append(
                {**pair, "variant": "theme", "test": test, "question": question, "again": again}
            )
    write_page(
        out,
        [dict(trial, id=n) for n, trial in enumerate(trials)],
        preference=True,
        intro=INTRO,
        chosen="the theme",
    )
    return measures


QUESTIONS = (
    (
        "identity",
        "Which clip sounds more like one piece of music with its own identity, "
        "the same piece from start to end?",
        False,
    ),
    ("keep", "Which clip would you rather keep listening to?", True),
)
INTRO = (
    "Both clips in a pair play the same movement from the same moment with the same random "
    "choices; only the notes MRT2 is given differ. Listen to both, then answer two questions "
    "about the pair. There is no right answer."
)


def summary(measures: dict, seeds) -> str:
    lines = [
        "| Seed | On the theme, early: theme / free | Later in the note | Silent "
        "| Level, dBFS RMS |",
        "| --- | --- | --- | --- | --- |",
    ]
    for seed in seeds:
        t, f = measures[f"theme-seed{seed}"], measures[f"free-seed{seed}"]
        lines.append(
            f"| {seed} | {_pct(t['early'])} / {_pct(f['early'])} "
            f"| {_pct(t['late'])} / {_pct(f['late'])} "
            f"| {t['silent']:.0%} / {f['silent']:.0%} | {t['level']:.1f} / {f['level']:.1f} |"
        )
    return "\n".join(lines)


def _pct(value):
    return "-" if value is None else f"{value:.0%}"


def main():
    parser = argparse.ArgumentParser(description="Compare the spine with and without a theme")
    parser.add_argument("--out", required=True, help="A new folder for results and audio")
    parser.add_argument("--seeds", type=int, default=6)
    parser.add_argument(
        "--calibrate", action="store_true", help="Measure when and how strongly to tell the theme"
    )
    parser.add_argument(
        "--ahead", type=int, default=Themed.ahead, help="Frames the theme is told early"
    )
    parser.add_argument(
        "--strength", type=float, default=Themed.strength, help="Note guidance in the theme"
    )
    args = parser.parse_args()
    out = Path(args.out).expanduser().resolve()
    out.mkdir(parents=True, exist_ok=False)
    from .music import MusicEngine

    engine = MusicEngine()
    seeds = list(range(100, 100 + args.seeds))
    if args.calibrate:
        rows = calibrate(engine, seeds)
        (out / "calibration.json").write_text(json.dumps(rows, indent=2) + "\n")
        print("| Told early | Strength | On the theme, early | Later in the note |")
        print("| --- | --- | --- | --- |")
        for row in rows:
            told = "no theme" if row["ahead"] is None else f"{row['ahead']:.2f} s"
            strength = "-" if row["strength"] is None else f"{row['strength']:.0f}"
            print(f"| {told} | {strength} | {_pct(row['early'])} | {_pct(row['late'])} |")
        return
    measures = run(out, engine, seeds, ahead=args.ahead, strength=args.strength)
    (out / "measures.json").write_text(json.dumps(measures, indent=2) + "\n")
    table = summary(measures, seeds)
    (out / "summary.md").write_text(table + "\n")
    print(table)


if __name__ == "__main__":
    main()
