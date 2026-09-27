"""Bounded stereo passages shared by the local store and the Colab adapter."""

import io

import numpy as np
import soundfile as sf

RATE = 48_000
MAX_AUDIO_BYTES = 16_000_000


def read_wave(raw):
    if len(raw) > MAX_AUDIO_BYTES:
        raise ValueError("Use a WAV file smaller than 16 MB")
    with sf.SoundFile(io.BytesIO(raw)) as file:
        if (
            file.format != "WAV"
            or file.samplerate != RATE
            or file.channels != 2
            or not RATE * 6 <= file.frames <= RATE * 33
        ):
            raise ValueError("Use 6-33 seconds of stereo, 48 kHz WAV audio")
        audio = file.read(dtype="float32", always_2d=True)
    if not np.isfinite(audio).all() or np.max(np.abs(audio)) < 1e-6:
        raise ValueError("The passage must contain finite, audible audio")
    return audio


def wave_bytes(audio):
    output = io.BytesIO()
    sf.write(output, audio, RATE, format="WAV", subtype="PCM_16")
    return output.getvalue()


def prepare_loop(audio, frames, target_rms=0.12):
    """Keep the requested grid, match level and soften the exact wrap boundary."""
    if audio.ndim != 2 or audio.shape[1] != 2 or not np.isfinite(audio).all():
        raise ValueError("Invalid stereo audio")
    if len(audio) < frames - RATE // 10:
        raise ValueError("The render is shorter than the requested passage")
    audio = np.pad(audio[:frames], ((0, max(0, frames - len(audio))), (0, 0))).copy()
    rms = float(np.sqrt(np.mean(audio.astype(np.float64) ** 2)))
    peak = float(np.max(np.abs(audio)))
    if rms < 1e-6:
        raise ValueError("The render is silent")
    audio *= min(target_rms / rms, 0.8 / max(peak, 1e-6))
    ramp = np.linspace(0, 1, 240, dtype=np.float32)
    audio[:240] *= ramp[:, None]
    audio[-240:] *= ramp[::-1, None]
    return audio


def sketch(variation=False):
    """An original, deterministic eight-bar sketch with a known 96 BPM grid."""
    beat = RATE * 60 / 96
    audio = np.zeros((round(32 * beat), 2), dtype=np.float32)
    rng = np.random.default_rng(557)

    def add(at, tone, pan=0):
        index = (round(at * beat) + np.arange(len(tone))) % len(audio)
        np.add.at(audio[:, 0], index, tone * (1 - pan * 0.3))
        np.add.at(audio[:, 1], index, tone * (1 + pan * 0.3))

    def note(pitch, seconds, level):
        t = np.arange(round(seconds * RATE)) / RATE
        hz = 440 * 2 ** ((pitch - 69) / 12)
        tone = np.sin(2 * np.pi * hz * t) + 0.25 * np.sin(4 * np.pi * hz * t)
        return level * tone * (1 - np.exp(-t * 200)) * np.exp(-t * 3)

    chords = ((57, 60, 64, 67), (53, 57, 60, 64), (55, 60, 64, 67), (55, 59, 62, 65))
    for bar in range(8):
        chord = chords[(bar // 2) % 4]
        for i, pitch in enumerate(chord):
            add(bar * 4 + i * 0.04, note(pitch, 2.3, 0.08), (i - 1.5) / 2)
        for offset in (0, 2.5):
            add(bar * 4 + offset, note(chord[0] - 24, 0.9, 0.23))
        for step in range(8):
            t = np.arange(3500) / RATE
            add(bar * 4 + step / 2, rng.normal(0, 0.014, len(t)) * np.exp(-t * 85), 0.4)
        for offset in (0, 2):
            t = np.arange(12000) / RATE
            add(
                bar * 4 + offset,
                0.18 * np.sin(2 * np.pi * (48 * t + 4 * (1 - np.exp(-t * 30)))) * np.exp(-t * 22),
            )
        for offset in (1, 3):
            t = np.arange(7000) / RATE
            add(bar * 4 + offset, rng.normal(0, 0.04, len(t)) * np.exp(-t * 38), -0.25)
        for i, offset in enumerate((0.5, 1.5, 3) if variation else (1.5, 3)):
            add(bar * 4 + offset, note(chord[(bar + i) % 4] + 12, 1.4, 0.11), -0.3)
    return prepare_loop(audio, len(audio))
