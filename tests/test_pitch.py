import numpy as np
import pytest

from sway import pitch

RATE = 48_000
A_MINOR = {9, 11, 0, 2, 4, 5, 7}
AM7 = [57, 60, 64, 67]  # V1's written A minor voicing.


def tone(midi, partials, seconds=2.0):
    """A steady note: `partials` maps harmonic number to amplitude."""
    t = np.arange(int(seconds * RATE)) / RATE
    f0 = 440 * 2 ** ((midi - 69) / 12)
    return sum(a * np.sin(2 * np.pi * h * f0 * t) for h, a in partials.items())


SAW = {h: 1 / h for h in range(1, 40)}  # Every harmonic, as in a synthesizer.
BRIGHT = {h: h**-0.5 for h in range(1, 30)}  # Slowly falling harmonics, as in brass.
ORGAN = {1: 1, 2: 0.8, 3: 0.7, 4: 0.6, 6: 0.5, 8: 0.4}  # Drawbars at several footages.
SINE = {1: 1}


def chord(notes, partials=SAW):
    return sum(tone(n, partials) for n in notes)


def raw_chroma_share(audio, classes):
    """V1's measure: every partial counted as a note."""
    spectrum = np.abs(np.fft.rfft(audio * np.hanning(len(audio)))) ** 2
    freqs = np.fft.rfftfreq(len(audio), 1 / RATE)
    band = (freqs > 60) & (freqs < 2000)
    classes_of = np.round(69 + 12 * np.log2(freqs[band] / 440)).astype(int) % 12
    chroma = np.bincount(classes_of, weights=spectrum[band], minlength=12)
    return sum(chroma[pc] for pc in classes) / chroma.sum()


@pytest.mark.parametrize("partials", [SAW, BRIGHT, ORGAN, SINE])
def test_a_bright_chord_in_key_is_in_key(partials):
    audio = chord(AM7, partials)
    energy = pitch.note_energy(audio, RATE)
    assert pitch.share(energy, A_MINOR) > 0.99
    assert pitch.share(energy, {p % 12 for p in AM7}) > 0.98


def test_overtones_made_v1s_measure_hear_wrong_notes():
    # The fifth harmonics of A and E are C sharp and G sharp, out of key.
    audio = chord(AM7, BRIGHT)
    assert raw_chroma_share(audio, A_MINOR) < 0.96
    assert pitch.share(pitch.note_energy(audio, RATE), A_MINOR) > 0.99


def test_the_notes_themselves_are_found():
    energy = pitch.note_energy(chord(AM7), RATE)
    assert set(np.argsort(energy)[-4:]) == set(AM7)


def test_an_out_of_key_note_is_heard():
    audio = chord([*AM7, 61])  # C sharp: one note in five.
    in_key = pitch.share(pitch.note_energy(audio, RATE), A_MINOR)
    assert 0.7 < in_key < 0.9


def test_a_low_note_is_not_mistaken_for_its_fifth_harmonic():
    audio = tone(45, SAW)  # A2; its fifth harmonic is close to C sharp 5.
    assert pitch.share(pitch.note_energy(audio, RATE), A_MINOR) > 0.99


def test_silence_has_no_notes():
    energy = pitch.note_energy(np.zeros(RATE), RATE)
    assert pitch.share(energy, A_MINOR) is None


def test_stereo_is_mixed_down():
    mono = chord(AM7)
    stereo = np.column_stack([mono, mono])
    assert np.allclose(pitch.note_energy(stereo, RATE), pitch.note_energy(mono, RATE))
