import math

import numpy as np
import pytest

from sway import steering
from sway.steering import FREE, NEUTRAL, SILENT, Move, Steered, ThereminHand, Window

SR = steering.SAMPLE_RATE
FRAME_SAMPLES = round(steering.FRAME * SR)


class FakeStyle:
    def embed(self, text):
        return np.random.default_rng(abs(hash(text)) % 2**32).standard_normal(8)

    def tokens(self, embedding):
        return np.zeros(12, dtype=np.int32)


class FakeEngine:
    """Plays one pitch per frame: random among the free ones, so seeds matter."""

    def __init__(self):
        self.style = FakeStyle()
        self.target = self.current = None
        self.style_tokens = np.zeros(12, dtype=np.int32)
        self.reset(0)

    def reset(self, seed):
        self.rng = np.random.default_rng(seed)
        self.frame = 0
        self.phase = 0.0

    def apply_style(self, embedding):
        self.target = embedding

    def generate(self, notes, drumless=False, note_guidance=1.0):
        allowed = np.flatnonzero(notes == FREE)
        self.frame += 1
        if not len(allowed):
            return np.zeros((FRAME_SAMPLES, 2), dtype=np.float32)
        pitch = int(self.rng.choice(allowed))
        freq = 440 * 2 ** ((pitch - 69) / 12)
        t = np.arange(FRAME_SAMPLES) / SR
        tone = 0.2 * np.sin(self.phase + 2 * np.pi * freq * t)
        self.phase = (self.phase + 2 * np.pi * freq * FRAME_SAMPLES / SR) % (2 * np.pi)
        return np.repeat(tone[:, None], 2, axis=1).astype(np.float32)

    def snapshot(self):
        return {"rng": self.rng.bit_generator.state, "frame": self.frame, "phase": self.phase}

    def restore(self, snapshot, seed=None):
        self.rng = np.random.default_rng()
        self.rng.bit_generator.state = snapshot["rng"]
        if seed is not None:
            self.rng = np.random.default_rng(seed)
        self.frame, self.phase = snapshot["frame"], snapshot["phase"]


def test_the_window_follows_height_and_stays_in_key():
    window = Window(FakeEngine())
    for height in (0.0, 0.5, 1.0):
        free = np.flatnonzero(window.notes(Move(height=height)) == FREE)
        centre = 55 + height * 24
        assert len(free) > 0
        assert all(p % 12 in steering.A_MINOR for p in free)
        assert all(abs(p - centre) <= 6 for p in free)


def free_classes(tokens):
    return {int(p) % 12 for p in np.flatnonzero(tokens == FREE)}


def test_spread_opens_the_harmony_and_height_leaves_the_notes_to_the_style():
    steered = Steered(FakeEngine())
    assert free_classes(steered.notes(Move(spread=0.1))) == {9, 0, 4}
    assert free_classes(steered.notes(Move(spread=0.5))) == {9, 0, 2, 4, 7}
    assert free_classes(steered.notes(Move(spread=0.9))) == steering.A_MINOR
    every_octave = np.flatnonzero(steered.notes(Move(spread=0.1)) == FREE)
    assert every_octave.min() <= 40 and every_octave.max() >= 91
    assert np.array_equal(steered.notes(Move(height=0.0)), steered.notes(Move(height=1.0)))


def test_stillness_silences_every_pitch():
    for variant in (Steered(FakeEngine()), Window(FakeEngine())):
        assert np.all(variant.notes(Move(activity=0.0)) == SILENT)


def test_the_style_blend_reaches_each_corner():
    steered = Steered(FakeEngine())
    assert steered.blend(Move(height=0, activity=0)).tolist() == [1, 0, 0, 0]
    assert steered.blend(Move(height=1, activity=0)).tolist() == [0, 1, 0, 0]
    assert steered.blend(Move(height=1, activity=1)).tolist() == [0, 0, 0, 1]
    assert "high register" in steered.corners[1] and "low register" in steered.corners[0]
    assert math.isclose(float(steered.blend(NEUTRAL).sum()), 1.0)


def test_a_glide_starts_from_the_first_movement_and_holds_the_second():
    moves = steering.glide(NEUTRAL, Move(height=1.0), 1.0, ramp=0.2)
    assert len(moves) == 25
    assert 0.5 < moves[0].height < 1.0
    assert moves[4].height == moves[-1].height == 1.0


def test_the_scripted_theremin_hand_follows_the_javascript_mapping():
    hand = ThereminHand()
    for _ in range(25):
        control = hand.update(Move(height=1.0, activity=0.4))
    assert control.pitch == steering.THEREMIN_PITCHES[-1]
    assert control.active and control.accent == 0  # A slow movement makes no strokes.
    for _ in range(25):
        control = hand.update(Move(height=1.0, activity=1.0))
    assert 3 <= control.accent <= 5  # Up to four strokes a second.
    for _ in range(75):
        control = hand.update(Move(height=1.0, activity=0.0))
    assert not control.active  # Stillness releases.


def tone(pitch, seconds, level=0.2):
    t = np.arange(round(seconds * SR)) / SR
    wave = level * np.sin(2 * np.pi * 440 * 2 ** ((pitch - 69) / 12) * t)
    return np.repeat(wave[:, None], 2, axis=1)


def clicks(per_second, seconds=1.5):
    audio = np.zeros((round(seconds * SR), 2))
    audio[:: SR // per_second] = 0.9
    return audio


def test_features_read_register_tension_loudness_silence_and_density():
    audio = np.concatenate([tone(69, 1.0), np.zeros((SR, 2)), tone(59, 1.0)])
    found = steering.features(np.concatenate([audio, clicks(2), clicks(8)]))
    times = found["time"]
    assert abs(np.nanmean(found["register"][times < 0.8]) - 69) < 0.5
    assert np.all(np.isnan(found["register"][(times > 1.2) & (times < 1.8)]))
    late = (times > 2.2) & (times < 2.8)
    assert abs(np.nanmean(found["register"][late]) - 59) < 0.5
    assert np.nanmax(found["tension"][times < 0.8]) < 0.05  # A is in the A minor triad.
    assert np.nanmin(found["tension"][late]) > 0.95  # B is not.
    assert found["notes"][np.argmin(np.abs(times - 0.5))][9] > 0.95  # One second of A.
    assert found["loudness"][(times > 1.2) & (times < 1.8)].max() == steering.FLOOR
    sparse = found["density"][np.argmin(np.abs(times - 3.75))]
    dense = found["density"][np.argmin(np.abs(times - 5.25))]
    assert dense > 2 * sparse > 0


def test_measure_separates_the_hand_from_the_seed():
    times = np.arange(100) * steering.HOP + steering.WINDOW / 2
    runs = {}
    for seed in range(4):
        noise = np.random.default_rng(seed).standard_normal(100) * 0.5
        a, b = 70 + noise, 60 + noise  # The movement moves the register by 10.
        a[times < 0.5] = 60 + noise[times < 0.5]  # ...after half a second.
        runs[seed] = {
            side: {
                "time": times,
                "register": values,
                "density": np.full(100, 2.0),
                "tension": np.zeros(100),
                "brightness": np.zeros(100),
                "loudness": np.full(100, -20.0),
                "notes": np.full((100, 12), 1 / 12),
            }
            for side, values in (("a", a), ("b", b))
        }
    result = steering.measure(steering.TESTS[0], runs)
    register = result["attributes"]["register"]
    assert register["influence"] == pytest.approx(10, abs=0.01)
    assert register["share"] > 0.9
    assert result["consistency"] == 1.0
    assert result["effect"] > 5
    assert 0.5 <= result["response"] <= 0.6
    assert 0.5 <= result["half"] <= 0.6


def test_runs_from_one_moment_are_reproducible_and_seeds_differ():
    window = Window(FakeEngine())
    first = steering.run_variant(window, seeds=[1, 2, 3], warmup=1.0, length=2.0)
    again = steering.run_variant(window, seeds=[1, 2, 3], warmup=1.0, length=2.0)
    assert first == again
    register = first["register"]
    assert register["consistency"] == 1.0
    assert register["attributes"]["register"]["share"] > 0.5
    assert register["attributes"]["notes"]["freedom"] > 0.1  # The fake picks notes at random.


def test_spreading_the_hands_adds_tension_to_what_the_model_plays():
    harmony = steering.run_variant(Steered(FakeEngine()), seeds=[1, 2, 3], warmup=1.0, length=2.0)
    assert harmony["harmony"]["consistency"] == 1.0
    assert harmony["harmony"]["effect"] > 1


def test_a_listening_page_can_ask_about_the_sound_of_one_test(tmp_path):
    import json

    harmony = [steering.TESTS[2]]
    steering.listening_page(
        tmp_path, ["steered"], [100, 101, 102], harmony, steering.SOUND_QUESTIONS
    )
    page = (tmp_path / "listening-test.html").read_text()
    trials = json.loads(page.split("const TRIALS = ")[1].split(";\n")[0])
    assert len(trials) == 3
    assert {t["question"] for t in trials} == {steering.SOUND_QUESTIONS["harmony"]}
    for trial in trials:
        a = f"steered/harmony-a-seed{trial['seed']}.wav"
        assert trial[trial["answer"]] == a
