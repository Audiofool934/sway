import numpy as np

from sway.music import conditioning


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
