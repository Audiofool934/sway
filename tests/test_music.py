import numpy as np

from sway.music import NotePlanner, conditioning


def test_graph_conditioning_preserves_unspecified_off_and_onset():
    notes = np.full(128, -1)
    notes[60], notes[64] = 0, 2
    cond, negative_style, negative_notes = conditioning(np.arange(12), notes)
    assert cond.shape == (141,)
    assert cond[12 + 60] == 7
    assert cond[12 + 64] == 9
    assert cond[12 + 61] == 6
    assert cond[-1] == 6
    assert np.all(negative_style[:12] == 6)
    assert np.all(negative_notes[12:140] == 6)
    assert np.array_equal(negative_style[12:], cond[12:])


def test_accent_has_onset_sustain_and_release():
    planner = NotePlanner()
    assert planner.next(108, "piano", accent=0)[60] == 2
    for _ in range(4):
        assert planner.next(108, "piano")[60] == 1
    assert planner.next(108, "piano")[60] == 0
    assert planner.next(108, "piano")[60] == -1


def test_harmony_evolves_while_state_is_retained():
    planner = NotePlanner()
    planner.beat = 15.99
    notes = planner.next(108, "piano", accent=0)
    assert notes[57] == 2  # A minor bass + one octave at the next phrase.
    assert planner.beat > 16


def test_articulation_changes_note_duration():
    short, long = NotePlanner(), NotePlanner()
    short.next(108, "piano", 0, "detached")
    long.next(108, "piano", 0, "flowing")
    for _ in range(3):
        a = short.next(108, "piano")
        b = long.next(108, "piano")
    assert a[60] == 0
    assert b[60] == 1
