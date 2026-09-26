import numpy as np

from sway.music import NotePlanner, conditioning, style_prompt


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


def test_guided_register_changes_real_conditioning_pitch():
    low, high = NotePlanner(), NotePlanner()
    a = low.next(120, "piano", 0, register=0.1, guided=True)
    b = high.next(120, "piano", 0, register=0.9, guided=True)
    assert np.flatnonzero(b == 2)[0] >= np.flatnonzero(a == 2)[0] + 12
    assert np.all(a[:48] == -1)
    assert np.count_nonzero(a[48:96] == 0) == 47


def test_guided_lead_waits_for_performed_accents():
    planner = NotePlanner()
    for _ in range(80):
        notes = planner.next(120, "piano", guided=True)
        assert not np.any(notes == 2)
    assert np.any(planner.next(120, "piano", 2, guided=True) == 2)


def test_strum_spreads_harmonically_valid_notes_over_successive_frames():
    planner = NotePlanner()
    planner.beat = 17  # A minor, so a fixed major-third recipe would be incorrect.
    pitches = []
    for i in range(3):
        notes = planner.next(120, "strum", 0 if i == 0 else None, guided=True)
        pitches.extend(np.flatnonzero(notes == 2))
    assert len(pitches) == 3
    assert all(p % 12 in {9, 0, 4} for p in pitches)


def test_non_piano_prompts_do_not_keep_requesting_piano():
    for palette in ("chamber", "nocturne", "groove"):
        for action in ("strum", "strike", "sustain"):
            assert "piano" not in style_prompt(palette, action).lower()
