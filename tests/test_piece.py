import numpy as np

from sway.arranger import world_plan
from sway.piece import Gesture, Piece, voice_weights
from sway.steering import FREE
from sway.world import FILM_SCORE

PLAYING = Gesture(dynamics=0.6, energy=0.6, voice=0.0, forward=0.8, articulation=0.2)
HUSHED = Gesture(dynamics=0.1, energy=0.1, hush=True)


class FakeStyle:
    def embed(self, text):
        return np.random.default_rng(abs(hash(text)) % 2**32).standard_normal(8)

    def tokens(self, embedding):
        return np.zeros(12, dtype=np.int32)


class FakeEngine:
    def __init__(self):
        self.style = FakeStyle()
        self.target = self.current = None

    def reset(self, seed):
        self.frame = 0

    def apply_style(self, embedding):
        self.target = embedding

    def generate(self, notes, drumless=False, note_guidance=1.0):
        self.last = notes.copy()
        self.frame += 1
        return np.full((1920, 2), 0.1, dtype=np.float32)

    def snapshot(self):
        return {"frame": self.frame}

    def restore(self, snapshot, seed=None):
        self.frame = snapshot["frame"]


# Frames until the next phrase is chosen: its first bar line, told `lead` frames early,
# on the frame after the last one of this phrase that is told.
NEXT = FILM_SCORE.phrase_frames - Piece.lead + 1


def piece():
    instrument = Piece(FakeEngine())
    instrument.start(1)
    return instrument


def play(instrument, frames, gesture=PLAYING):
    for _ in range(frames):
        instrument.render(gesture)


def told(instrument):
    return {pitch % 12 for pitch in np.flatnonzero(instrument.engine.last == FREE)}


def plans(section="peak", move_on="release"):
    return (
        world_plan(FILM_SCORE, section, ("Bb", "F", "C", "Dm"), f"{section}!", "qwen"),
        world_plan(FILM_SCORE, move_on, ("Gm", "Dm", "Bb", "Am"), f"{move_on}!", "qwen"),
    )


def test_the_left_hand_chooses_the_voice_and_how_far_it_comes_forward():
    assert np.allclose(voice_weights(0.0, 1.0), [0, 1, 0, 0])  # Violins.
    assert np.allclose(voice_weights(0.25, 1.0), [0, 0.5, 0.5, 0])  # Between them and brass.
    assert np.allclose(voice_weights(1.0, 1.0), [0, 0, 0, 1])  # Cellos and basses.
    assert np.allclose(voice_weights(0.0, 0.0), [1, 0, 0, 0])  # A low hand: balanced.
    assert np.allclose(voice_weights(1.0, 0.5), [0.5, 0, 0, 0.5])


def test_each_gesture_at_its_extreme_reaches_one_whole_corner():
    instrument = piece()
    loudest = Gesture(dynamics=1, energy=1, voice=1, forward=1, articulation=1)
    assert np.allclose(instrument.blend(loudest), np.eye(16)[15])  # Cellos, driving, short.
    softest = Gesture(dynamics=0, energy=0, voice=0, forward=0, articulation=0)
    assert np.allclose(instrument.blend(softest), np.eye(16)[0])  # Balanced, calm, long.
    weights = instrument.blend(Gesture(dynamics=1, energy=0, forward=0))
    assert np.isclose(weights.sum(), 1) and np.isclose(weights[2], 0.4)  # Dynamics' share.


def test_the_piece_opens_with_the_world_s_intro_and_tells_each_chord_ahead():
    instrument = piece()
    assert instrument.phrase.plan.section == "intro" and instrument.phrase.plan.source == "world"
    heard = []
    for _ in range(FILM_SCORE.phrase_frames - instrument.lead):
        if instrument.frame % instrument.bar_frames == 0:
            heard.append(instrument.chord[0])
        name, tones = instrument.harmony
        instrument.render(PLAYING)
        # The harmony is the composer's: the chord's tones and the pentatonic scale.
        assert told(instrument) == set(tones) | FILM_SCORE.pentatonic
    assert heard == ["Dm", "Bb", "F", "C"]


def test_the_composer_is_asked_once_a_phrase_and_its_plans_play_next():
    instrument = piece()
    ticket, summary = instrument.request()
    assert summary.section == "intro" and summary.phrase == 0 and not summary.played
    assert instrument.request() is None  # Asked once.
    assert instrument.offer(ticket, plans())
    play(instrument, NEXT)
    assert instrument._phrase_at(instrument.frame + instrument.lead).plan.section == "peak"
    ticket, summary = instrument.request()
    assert ticket == 1 and summary.section == "peak" and summary.history == ("intro",)
    assert summary.played and summary.energy == 0.6 and summary.still == 0
    assert summary.voice == "violins" and np.isclose(summary.articulation, 0.2)
    assert not instrument.offer(0, plans())  # An answer to an old request is dropped.


def test_without_the_composer_the_world_s_own_plans_play():
    instrument = piece()
    play(instrument, NEXT)
    assert instrument._phrase_at(instrument.frame + instrument.lead).plan.section == "intro"
    play(instrument, FILM_SCORE.phrase_frames)
    nxt = instrument._phrase_at(instrument.frame + instrument.lead).plan
    assert nxt.section == "build" and nxt.source == "world"  # Two phrases, then on.


def test_moving_on_lands_on_the_first_bar_line_the_model_can_reach():
    instrument = piece()
    ticket, _ = instrument.request()
    instrument.offer(ticket, plans(move_on="build"))
    play(instrument, 100)  # Told: frame 130, inside bar 2.
    instrument.cue()
    assert instrument.landing == 150  # The next bar line.
    assert instrument.describe()["landing"] == 50
    instrument.cue()  # Ignored until the first move is heard.
    play(instrument, 20)
    assert instrument._phrase_at(instrument.frame + instrument.lead).plan.section == "build"
    assert instrument.phrase.plan.section == "intro"  # Still heard until frame 150.
    play(instrument, 30)
    assert instrument.phrase.plan.section == "build" and instrument.landing is None
    assert instrument.describe()["chordIndex"] == 0
    _, summary = instrument.request()
    assert summary.cues == 1 and summary.section == "build"


def test_moving_on_without_plans_goes_to_the_world_s_next_section():
    instrument = piece()
    play(instrument, 40)  # Told: frame 70, so the next bar line is 75.
    instrument.cue()
    assert instrument.landing == 75
    play(instrument, 35)
    assert instrument.phrase.plan.section == "build"


def test_the_section_s_sound_is_a_fifth_of_the_style():
    instrument = piece()
    play(instrument, 200)
    hands = instrument.weights @ instrument.styles
    direction = instrument.directions[instrument.phrase.plan.direction]
    expected = 0.8 * hands + 0.2 * direction
    assert np.allclose(instrument.engine.current, expected, atol=1e-4)


def test_a_hush_thins_the_music_and_the_composer_hears_it():
    instrument = piece()
    instrument.request()
    play(instrument, 150, HUSHED)
    assert abs(instrument.gain - instrument.rest_level) < 0.02
    play(instrument, NEXT - 150)
    _, summary = instrument.request()
    assert 0.5 < summary.still < 0.6 and summary.energy_change > 0.4


def test_a_copied_moment_keeps_the_piece_s_place():
    instrument = piece()
    ticket, _ = instrument.request()
    instrument.offer(ticket, plans())
    play(instrument, 120)
    moment = instrument.snapshot()
    play(instrument, 300)
    instrument.restore(moment, 2)
    assert instrument.frame == 120 and instrument.pending[0] == ticket
    assert [p.start for p in instrument.phrases] == [0]


def test_each_section_plays_at_the_score_s_level():
    instrument = piece()
    audio = instrument.render(PLAYING)
    assert np.isclose(instrument.level, 10 ** (-6 / 20))  # The intro, from its start.
    assert np.allclose(np.abs(audio).max(), 0.1 * 10 ** (-6 / 20), rtol=1e-3)
    instrument.offer(instrument.request()[0], plans(section="peak"))
    play(instrument, FILM_SCORE.phrase_frames + 75)  # 3 s into the peak, near full level.
    assert instrument.phrase.plan.section == "peak"
    assert instrument.level > 0.95
