"""Which sound descriptions does MRT2 Small keep in key, as V1's band writes its harmony?

Renders the same twelve bars for each description, in one continuing stream: Am, F, C,
and G held for eight bars, then struck on every beat for four. Each bar is measured as in
tests/test_harmony.py, and each take is saved for listening.

    uv run --locked python scripts/probe_palettes.py outputs/palette-probe
"""

import argparse
import json
import time
import wave
from pathlib import Path

import numpy as np

from sway import harmony
from sway.schema import HarmonyNote

DESCRIPTIONS = {
    # V1's palettes, as the baseline.
    "strings": harmony.PALETTES["strings"],
    "piano": harmony.PALETTES["piano"],
    "choir": harmony.PALETTES["choir"],
    # Sounds a bandleader might ask for.
    "rhodes": "Warm Rhodes electric piano chords, soft, mellow, instrumental",
    "nylon-guitar": "Nylon string guitar chords, gentle, warm, instrumental",
    "clean-guitar": "Clean electric guitar chords, warm, gentle, instrumental",
    "brass": "Soft brass section swells, warm French horns, instrumental",
    "woodwinds": "Soft woodwind ensemble, flutes and clarinets, warm, instrumental",
    "cellos": "Cello ensemble, legato, warm, expressive, instrumental",
    "harp": "Concert harp chords, delicate, ambient, instrumental",
    "vibraphone": "Vibraphone chords, soft mallets, warm, ambient, instrumental",
    "organ": "Soft Hammond organ chords, warm, gentle, instrumental",
    "synth-pad": "Warm analog synthesizer pad, slow attack, ambient, instrumental",
}
# V1's chords (web/instrument/theory.js): the chord's pitch classes and its written voicing.
CHORDS = {
    "Am": ([9, 0, 4], [57, 60, 64, 67]),
    "F": ([5, 9, 0], [53, 57, 60, 64]),
    "C": ([0, 4, 7], [55, 60, 64, 67]),
    "G": ([7, 2], [55, 62, 64, 69]),
}
PROGRESSION = ["Am", "F", "C", "G"]
A_MINOR = {9, 11, 0, 2, 4, 5, 7}
TEMPO, BEATS = 100, 4
SKIP = 9600  # A bar's first 200 ms, where the previous chord may still ring.


def share(audio, classes):
    """Share of 60 Hz to 2 kHz spectral energy on the pitch classes `classes`."""
    mono = audio.astype(np.float64).mean(axis=1)
    spectrum = np.abs(np.fft.rfft(mono * np.hanning(len(mono)))) ** 2
    freqs = np.fft.rfftfreq(len(mono), 1 / harmony.SAMPLE_RATE)
    band = (freqs > 60) & (freqs < 2000)
    pcs = np.round(69 + 12 * np.log2(freqs[band] / 440)).astype(int) % 12
    chroma = np.bincount(pcs, weights=spectrum[band], minlength=12)
    return float(sum(chroma[pc] for pc in classes) / chroma.sum())


def bar_notes(voicing, texture, carried):
    """One bar as the band writes it: held, tying common tones, or struck on each beat."""
    if texture == "pulse":
        return [HarmonyNote(pitch=p, start=b, length=1) for p in voicing for b in range(BEATS)]
    return [HarmonyNote(pitch=p, start=0, length=BEATS, tie=p in carried) for p in voicing]


def probe(renderer, key, frames, seed):
    renderer.start(key, seed=seed)
    plan = [(PROGRESSION[i % 4], "hold") for i in range(8)]
    plan += [(PROGRESSION[i % 4], "pulse") for i in range(4)]
    takes, bars, carried = [], [], set()
    for name, texture in plan:
        tones, voicing = CHORDS[name]
        audio = renderer.render(bar_notes(voicing, texture, carried), tones, key, frames, BEATS)
        carried = set(voicing) if texture == "hold" else set()
        takes.append(audio)
        body = audio[SKIP:]
        bars.append(
            {
                "chord": name,
                "texture": texture,
                "in_key": round(share(body, A_MINOR), 3),
                "in_chord": round(share(body, {p % 12 for p in voicing}), 3),
                "rms_db": round(20 * float(np.log10(np.sqrt(np.mean(body**2)) + 1e-9)), 1),
            }
        )
    return np.concatenate(takes), bars


def summary(bars):
    def median(texture, field):
        return round(float(np.median([b[field] for b in bars if b["texture"] == texture])), 3)

    return {
        "held_in_key": median("hold", "in_key"),
        "held_in_chord": median("hold", "in_chord"),
        "struck_in_key": median("pulse", "in_key"),
        "bars_under_90": sum(b["in_key"] < 0.9 for b in bars),
        "rms_db": round(float(np.median([b["rms_db"] for b in bars])), 1),
    }


def save(path, audio):
    pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as out:
        out.setnchannels(2)
        out.setsampwidth(2)
        out.setframerate(harmony.SAMPLE_RATE)
        out.writeframes(pcm.tobytes())


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("output", type=Path, help="Directory for the takes and results.json")
    parser.add_argument("--seed", type=int, default=11)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    harmony.PALETTES.update(DESCRIPTIONS)
    renderer = harmony.HarmonyRenderer()
    frames = harmony.frames_per_bar(TEMPO, BEATS)
    results = {}
    for key, description in DESCRIPTIONS.items():
        started = time.perf_counter()
        audio, bars = probe(renderer, key, frames, args.seed)
        save(args.output / f"{key}.wav", audio)
        seconds = round(time.perf_counter() - started, 1)
        results[key] = {"description": description, "seconds": seconds, **summary(bars)}
        print(key, results[key], flush=True)
        results[key]["bars"] = bars
    (args.output / "results.json").write_text(json.dumps(results, indent=2) + "\n")


if __name__ == "__main__":
    main()
