import numpy as np

from sway.arranger import Plan
from sway.piece import Piece
from sway.steering import FREE, Move
from sway.world import FILM_SCORE

PLAYING = Move(height=0.6, activity=0.6, spread=0.1)
STILL = Move(height=0.6, activity=0.0, spread=0.1)


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


def play(instrument, frames, move=PLAYING):
    for _ in range(frames):
        instrument.render(move)


def told(instrument):
    return {pitch % 12 for pitch in np.flatnonzero(instrument.engine.last == FREE)}


def plans(section="peak", clap="release"):
    def make(name, chords):
        return Plan(name, chords, f"{name} direction", f"{name}!", "qwen")

    return make(section, ("Bb", "F", "C", "Dm")), make(clap, ("Gm", "Dm", "Bb", "Am"))


def embedded(pair):
    return {plan.direction: FakeStyle().embed(plan.direction) for plan in pair}


def test_the_piece_opens_with_the_world_s_intro_and_tells_each_chord_ahead():
    instrument = piece()
    assert instrument.phrase.plan.section == "intro" and instrument.phrase.plan.source == "world"
    heard = []
    for _ in range(FILM_SCORE.phrase_frames - instrument.lead):
        if instrument.frame % instrument.bar_frames == 0:
            heard.append(instrument.chord[0])
        name, tones = instrument.harmony
        instrument.render(PLAYING)
        assert told(instrument) == set(tones)
    assert heard == ["Dm", "Bb", "F", "C"]
    assert instrument.harmony[0] == "Dm"  # The second phrase is told from frame 270.


def test_the_arranger_is_asked_once_a_phrase_and_its_plans_play_next():
    instrument = piece()
    ticket, summary = instrument.request()
    assert summary.section == "intro" and summary.phrase == 0 and not summary.played
    assert instrument.request() is None  # Asked once.
    assert instrument.offer(ticket, plans(), embedded(plans()))
    play(instrument, NEXT)
    assert instrument._phrase_at(instrument.frame + instrument.lead).plan.section == "peak"
    ticket, summary = instrument.request()
    assert ticket == 1 and summary.section == "peak" and summary.history == ("intro",)
    assert summary.activity == 0.6 and summary.still == 0 and summary.played
    # An answer to an old request is dropped.
    assert not instrument.offer(0, plans(), embedded(plans()))


def test_without_the_arranger_the_world_s_own_plans_play():
    instrument = piece()
    play(instrument, NEXT)
    assert instrument._phrase_at(instrument.frame + instrument.lead).plan.section == "intro"
    play(instrument, FILM_SCORE.phrase_frames)
    nxt = instrument._phrase_at(instrument.frame + instrument.lead).plan
    assert nxt.section == "build" and nxt.source == "world"  # Two phrases, then on.


def test_a_clap_moves_on_at_the_first_bar_line_the_model_can_reach():
    instrument = piece()
    ticket, _ = instrument.request()
    instrument.offer(ticket, plans(clap="build"), embedded(plans(clap="build")))
    play(instrument, 100)  # Told: frame 130, inside bar 2.
    instrument.cue()
    assert instrument.landing == 150  # The next bar line.
    assert instrument.describe()["landing"] == 50
    instrument.cue()  # Ignored until the first clap is heard.
    play(instrument, 20)
    assert instrument._phrase_at(instrument.frame + instrument.lead).plan.section == "build"
    assert instrument.phrase.plan.section == "intro"  # Still heard until frame 150.
    play(instrument, 30)
    assert instrument.phrase.plan.section == "build" and instrument.landing is None
    assert instrument.describe()["chordIndex"] == 0
    _, summary = instrument.request()
    assert summary.claps == 1 and summary.section == "build"


def test_a_clap_without_plans_moves_on_to_the_world_s_next_section():
    instrument = piece()
    play(instrument, 40)  # Told: frame 70, so the next bar line is 75.
    instrument.cue()
    assert instrument.landing == 75
    play(instrument, 35)
    assert instrument.phrase.plan.section == "build"


def test_the_phrase_s_direction_joins_the_hands_in_the_style():
    instrument = piece()
    play(instrument, 200)
    hands = instrument.weights @ instrument.styles
    direction = instrument.directions[instrument.phrase.plan.direction]
    expected = (1 - instrument.direction_weight) * hands + instrument.direction_weight * direction
    assert np.allclose(instrument.engine.current, expected, atol=1e-4)


def test_stillness_is_heard_by_the_arranger():
    instrument = piece()
    instrument.request()
    play(instrument, 150, STILL)
    play(instrument, NEXT - 150)
    _, summary = instrument.request()
    assert 0.5 < summary.still < 0.6 and summary.activity_change > 0.5


def test_a_copied_moment_keeps_the_piece_s_place():
    instrument = piece()
    ticket, _ = instrument.request()
    instrument.offer(ticket, plans(), embedded(plans()))
    play(instrument, 120)
    moment = instrument.snapshot()
    play(instrument, 300)
    instrument.restore(moment, 2)
    assert instrument.frame == 120 and instrument.pending[0] == ticket
    assert [p.start for p in instrument.phrases] == [0]
