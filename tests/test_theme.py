import json
import re

import numpy as np
import pytest

from sway import steering, theme
from sway.steering import FREE, HELD, SILENT, STRUCK, Move, Spine
from sway.theme import FORM, MELODY, THEME, Themed

SR = steering.SAMPLE_RATE
FRAME_SAMPLES = round(steering.FRAME * SR)


class FakeStyle:
    def embed(self, text):
        return np.random.default_rng(abs(hash(text)) % 2**32).standard_normal(8)

    def tokens(self, embedding):
        return np.zeros(12, dtype=np.int32)


class FakeEngine:
    """Plays the notes it must play at once, or else one free pitch at random."""

    def __init__(self):
        self.style = FakeStyle()
        self.target = self.current = None
        self.style_tokens = np.zeros(12, dtype=np.int32)
        self.guidance = []
        self.reset(0)

    def reset(self, seed):
        self.rng = np.random.default_rng(seed)
        self.frame = 0

    def apply_style(self, embedding):
        self.target = embedding

    def snapshot(self):
        return {"rng": self.rng.bit_generator.state, "frame": self.frame}

    def restore(self, snapshot, seed=None):
        self.rng = np.random.default_rng(seed)
        self.frame = snapshot["frame"]

    def generate(self, notes, drumless=False, note_guidance=1.0):
        self.last = notes.copy()
        self.guidance.append(note_guidance)
        self.frame += 1
        pitches = np.flatnonzero(notes >= HELD)
        if not len(pitches):
            allowed = np.flatnonzero(notes == FREE)
            if not len(allowed):
                return np.zeros((FRAME_SAMPLES, 2), dtype=np.float32)
            pitches = [int(self.rng.choice(allowed))]
        t = (self.frame * FRAME_SAMPLES + np.arange(FRAME_SAMPLES)) / SR
        tone = sum(0.1 * np.sin(2 * np.pi * 440 * 2 ** ((p - 69) / 12) * t) for p in pitches)
        return np.repeat(tone[:, None], 2, axis=1).astype(np.float32)


def themed(form=FORM, **kwargs):
    variant = Themed(FakeEngine(), form, **kwargs)
    variant.start(1)
    return variant


def first_theme_frame(variant):
    return variant.start_bar * variant.bar_frames


def test_the_theme_is_the_only_note_from_middle_c_up_and_is_struck_then_held():
    variant = themed()
    variant.frame = first_theme_frame(variant) - variant.ahead
    tokens = variant.notes(Move())
    (pitch, _), *_ = THEME[0]
    assert tokens[pitch] == STRUCK
    assert set(np.delete(tokens[MELODY:], pitch - MELODY)) == {SILENT}
    assert FREE in tokens[:MELODY], "below middle C the spine's harmony stays free"
    variant.frame += 1
    assert variant.notes(Move())[pitch] == HELD


def test_the_theme_is_told_ahead_and_outside_its_bars_the_spine_plays_as_ever():
    variant = themed()
    spine = Spine(variant.engine)
    spine.start(1)
    before = first_theme_frame(variant) - variant.ahead - 1
    variant.frame = spine.frame = before
    assert np.array_equal(variant.notes(Move()), spine.notes(Move()))
    variant.frame = before + 1
    assert variant.notes(Move())[THEME[0][0][0]] == STRUCK


def test_each_bar_of_the_theme_plays_its_notes_on_their_beats():
    variant = themed(ahead=0)
    beat = variant.bar_frames // variant.beats_per_bar
    start = first_theme_frame(variant)
    for bar, notes in enumerate(THEME):
        at = start + bar * variant.bar_frames
        for pitch, beats in notes:
            assert variant.theme_at(at) == (pitch, True)
            assert variant.theme_at(at + beats * beat - 1) == (pitch, False)
            at += beats * beat


def test_the_theme_is_told_strongly_and_the_rest_with_the_spine_s_guidance():
    variant = themed(ahead=0, strength=3.0)
    engine = variant.engine
    for _ in range(first_theme_frame(variant) + 1):
        variant.render(Move())
    assert engine.guidance[-2:] == [Spine.guidance, 3.0]


def test_the_theme_plays_only_in_whole_statements():
    with pytest.raises(ValueError):
        Themed(FakeEngine(), (True,) * 3 + (False,))
    with pytest.raises(ValueError):
        Themed(FakeEngine(), FORM, start=1)


def test_the_theme_s_notes_start_on_their_beats_in_seconds():
    notes = theme.theme_notes(FORM)
    beat = 60 / Spine.tempo
    assert notes[0] == (0.0, beat, 69)
    assert notes[4] == (4 * beat, 3 * beat, 72)
    returns = [start for start, _, pitch in notes if start in (12 * 4 * beat, 20 * 4 * beat)]
    assert len(returns) == 2


def test_both_clips_of_a_pair_are_brought_to_one_level_below_full_scale():
    rng = np.random.default_rng(0)
    quiet = 0.01 * rng.standard_normal((48_000, 2))
    loud = 0.3 * rng.standard_normal((48_000, 2))
    a, b = theme.matched(quiet, loud)
    assert theme.rms_db(a) == pytest.approx(theme.rms_db(b))
    assert max(np.abs(a).max(), np.abs(b).max()) <= 10 ** (theme.PEAK / 20) + 1e-9


def test_a_played_theme_is_measured_on_its_notes_and_the_free_clip_is_not():
    takes = theme.Takes(FakeEngine())
    notes = theme.theme_notes(FORM)
    with_theme = theme.on_theme(takes.play(3, FORM, ahead=0), notes)
    without = theme.on_theme(takes.play(3, (False,) * len(FORM), ahead=0), notes)
    assert with_theme["early"] > 0.9 and with_theme["late"] > 0.9
    assert without["late"] < 0.5


def test_the_page_asks_two_questions_of_each_pair_and_counts_the_theme(tmp_path):
    measures = theme.run(tmp_path, FakeEngine(), [1, 2], ahead=0)
    page = (tmp_path / "listening-test.html").read_text()
    trials = json.loads(re.search(r"const TRIALS = (.*);", page).group(1))
    assert [t["test"] for t in trials] == ["identity", "keep"] * 2
    for first, second in zip(trials[::2], trials[1::2], strict=True):
        assert (first["x"], first["y"], first["answer"]) == (
            second["x"],
            second["y"],
            second["answer"],
        )
        assert not first["again"] and second["again"]
        assert first[first["answer"]].startswith("theme-")
    assert "the theme" in page and theme.INTRO in page
    assert sorted(measures) == ["free-seed1", "free-seed2", "theme-seed1", "theme-seed2"]
    for name in measures:
        assert (tmp_path / f"{name}.wav").exists() and (tmp_path / "raw" / f"{name}.wav").exists()


def looped():
    variant = theme.ThemeLoop(FakeEngine())
    variant.start(1)
    return variant


def told(variant, move, bars):
    """The theme's pitches MRT2 is told, for `bars` bars of `move`."""
    pitches = []
    for _ in range(bars * variant.bar_frames):
        variant.render(move)
        row = variant.engine.last
        pitches.append(set(np.flatnonzero(row >= HELD)))
    return pitches


def test_the_live_theme_returns_every_twelve_bars_after_four_away():
    variant = looped()
    frames = told(variant, Move(height=0.5, activity=0.6), 20)
    bars = [any(frames[b * variant.bar_frames : (b + 1) * variant.bar_frames]) for b in range(20)]
    assert bars == [False] * 4 + [True] * 4 + [False] * 8 + [True] * 4
    assert frames[4 * variant.bar_frames] == {THEME[0][0][0]}


def test_height_chooses_the_live_theme_s_octave_at_each_bar_line():
    variant = looped()
    told(variant, Move(height=0.1, activity=0.6), 4)
    (pitch, _), *_ = THEME[0]
    variant.render(Move(height=0.1, activity=0.6))
    row = variant.engine.last
    assert row[pitch - 12] == STRUCK and variant.melody == MELODY - 12
    assert set(np.delete(row[MELODY - 12 :], pitch - 12 - (MELODY - 12))) == {SILENT}
    variant.render(Move(height=0.9, activity=0.6))  # Mid-bar: the octave holds.
    assert variant.engine.last[pitch - 12] == HELD
    variant = looped()
    told(variant, Move(height=0.9, activity=0.6), 4)
    variant.render(Move(height=0.9, activity=0.6))
    assert variant.engine.last[pitch + 12] == STRUCK


def test_stillness_rests_the_live_theme_and_moving_again_strikes_it():
    variant = looped()
    told(variant, Move(activity=0.6), 4)
    frames = told(variant, Move(activity=0.0), 1)
    assert not any(frames)
    assert variant.describe() == {"theme": "resting", "themeIn": 0}
    variant.render(Move(activity=0.6))
    held = [p for p in np.flatnonzero(variant.engine.last >= HELD) if p >= MELODY]
    assert len(held) == 1 and variant.engine.last[held[0]] == STRUCK


def test_the_live_theme_says_how_many_bars_until_it_returns():
    variant = looped()
    assert variant.describe() == {"theme": "away", "themeIn": 4}
    told(variant, Move(activity=0.6), 3)
    assert variant.describe() == {"theme": "away", "themeIn": 1}
    told(variant, Move(activity=0.6), 1)
    assert variant.describe() == {"theme": "playing", "themeIn": 0}
    told(variant, Move(activity=0.6), 4)
    assert variant.describe() == {"theme": "away", "themeIn": 8}
