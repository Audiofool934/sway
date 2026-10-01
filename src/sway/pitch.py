"""Which notes a stretch of audio plays, judged from its spectrum.

A harmonic sound's partials are overtones of its notes, so counting every partial as a
note mistakes timbre for harmony: the fifth harmonic of an in-key A is an out-of-key C#.
Notes are found instead by harmonic summation, strongest first, removing each note's
partials before looking for the next, in the manner of Klapuri's iterative estimation of
multiple fundamental frequencies.
"""

import numpy as np

CENTS = 45  # A partial is looked for this close to its ideal frequency.
HIGHEST_PARTIAL = 5_000  # Hz.


def note_energy(audio, sample_rate, *, low=36, high=84, notes=12, floor=0.03):
    """The energy of each MIDI pitch from `low` to `high` that `audio` plays, as 128 values.

    `audio` is mono, or (samples, channels). Each note's energy is that of all its
    partials. The search stops after `notes` notes, or at one whose salience is below
    `floor` of the strongest note's.
    """
    mono = np.asarray(audio, dtype=np.float64)
    if mono.ndim == 2:
        mono = mono.mean(axis=1)
    power = np.abs(np.fft.rfft(mono * np.hanning(len(mono)))) ** 2
    freqs = np.fft.rfftfreq(len(mono), 1 / sample_rate)
    pitches = np.arange(low, high + 1)
    spread = 2 ** (CENTS / 1200)
    candidates = []
    for pitch in pitches:
        f0 = 440 * 2 ** ((pitch - 69) / 12)
        partials = np.arange(1, int(HIGHEST_PARTIAL // f0) + 1)
        start = np.searchsorted(freqs, partials * f0 / spread)
        stop = np.maximum(np.searchsorted(freqs, partials * f0 * spread), start + 1)
        candidates.append((start, stop, 1 / partials))
    energy = np.zeros(128)
    residual = power.copy()
    strongest = None
    for _ in range(notes):
        saliences = [_salience(residual, *candidate) for candidate in candidates]
        best = int(np.argmax(saliences))
        strongest = strongest or saliences[best]
        if not strongest or saliences[best] < floor * strongest:
            break
        start, stop, _ = candidates[best]
        for a, b in zip(start, stop, strict=True):
            energy[pitches[best]] += residual[a:b].sum()
            residual[a:b] = 0
    return energy


def _salience(power, start, stop, weights):
    """Weighted sum of the magnitudes of a candidate note's partials."""
    peaks = np.maximum.reduceat(power, np.ravel(np.column_stack([start, stop])))[::2]
    return float(np.sum(weights * np.sqrt(peaks)))


def share(energy, classes):
    """The share of the notes' energy on the pitch classes `classes`, or None for silence."""
    total = float(energy.sum())
    if total <= 0:
        return None
    on = np.isin(np.arange(len(energy)) % 12, list(classes))
    return float(energy[on].sum() / total)
