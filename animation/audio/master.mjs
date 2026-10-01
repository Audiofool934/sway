// Master the film's soundtrack: lay the finale (played by Sway's own synthesizer) onto the
// synthesized chapters, balance it against them, and write the files the film is muxed from.
//
//   node audio/master.mjs     -> out/soundtrack.wav (float, 48 kHz), plus .m4a and .ogg for the preview page
//   options: --finale -16     loudness of the finale's playing section, in LUFS
//            --target -17     integrated loudness of the whole film, in LUFS

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DURATION, SR, byId } from "../src/timeline.js";
import {
  compress,
  dB,
  filter,
  limit,
  loudness,
  peak,
  smoothstep,
} from "./dsp.js";
import { readWav, writeWav } from "./wav.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? Number(args[at + 1]) : fallback;
};
const FINALE_LUFS = option("finale", -16);
const TARGET_LUFS = option("target", -17);
const CEILING = -1;

const eras = readWav(join(ROOT, "out", "eras.wav"));
const finale = readWav(join(ROOT, "out", "finale.wav"));
const meta = JSON.parse(readFileSync(join(ROOT, "out", "finale.json"), "utf8"));
if (eras.rate !== SR || finale.rate !== SR)
  throw new Error(`expected ${SR} Hz audio`);

const frames = Math.round(DURATION * SR);
const L = new Float32Array(frames);
const R = new Float32Array(frames);
const [eL, eR] = eras.channels;
L.set(eL.subarray(0, frames));
R.set(eR.subarray(0, frames));

// The finale: master it the way the chapters were (rumble out, glue, catch peaks), at a
// loudness chosen so the playing section is the film's biggest moment without being loud.
const [fL, fR] = finale.channels.map((c) => Float32Array.from(c));
filter(fL, "highpass", 28, 0.7);
filter(fR, "highpass", 28, 0.7);
const playing = [0, byId.end.start - meta.start];
let trim = 0;
let chained = null;
for (let pass = 0; pass < 4; pass++) {
  const a = Float32Array.from(fL);
  const b = Float32Array.from(fR);
  const gain = dB(trim);
  for (let i = 0; i < a.length; i++) {
    a[i] *= gain;
    b[i] *= gain;
  }
  compress(a, b, {
    threshold: -20,
    ratio: 2.2,
    attack: 0.02,
    release: 0.3,
    knee: 8,
    makeup: 2,
  });
  limit(a, b, { ceiling: -1.5 });
  const measured = loudness(a, b, playing[0], playing[1]);
  chained = { a, b, measured };
  if (Math.abs(measured - FINALE_LUFS) < 0.05) break;
  trim += FINALE_LUFS - measured;
}
console.log(
  `finale   playing section ${chained.measured.toFixed(1)} LUFS (trim ${trim >= 0 ? "+" : ""}${trim.toFixed(1)} dB before the master chain)`,
);

// Lay it in at its film time. It enters on the downbeat the Delegate chapter builds toward,
// with a few milliseconds of fade so the join can never click.
const offset = Math.round(meta.start * SR);
const fadeIn = Math.round(0.004 * SR);
for (let i = 0; i < chained.a.length && offset + i < frames; i++) {
  const g = i < fadeIn ? i / fadeIn : 1;
  L[offset + i] += chained.a[i] * g;
  R[offset + i] += chained.b[i] * g;
}

// The tune ends where the picture does: the last chord rings and is gone by the end card's close.
const fadeFrom = Math.round((DURATION - 2.6) * SR);
for (let i = fadeFrom; i < frames; i++) {
  const g = 1 - smoothstep((i - fadeFrom) / (frames - fadeFrom));
  L[i] *= g;
  R[i] *= g;
}
const lead = Math.round(0.02 * SR);
for (let i = 0; i < lead; i++) {
  L[i] *= i / lead;
  R[i] *= i / lead;
}

// Normalize the whole film to a single integrated loudness, then catch any peak.
const before = loudness(L, R);
const gain = dB(TARGET_LUFS - before);
for (let i = 0; i < frames; i++) {
  L[i] *= gain;
  R[i] *= gain;
}
const preLimit = Math.max(peak(L), peak(R));
limit(L, R, { ceiling: CEILING, lookahead: 0.005, release: 0.12 });
const integrated = loudness(L, R);
console.log(
  `film     ${before.toFixed(1)} LUFS -> ${integrated.toFixed(1)} LUFS integrated (gain ${(TARGET_LUFS - before).toFixed(1)} dB, pre-limiter peak ${(20 * Math.log10(preLimit)).toFixed(1)} dBFS)`,
);
console.log(
  `peak     ${(20 * Math.log10(Math.max(peak(L), peak(R)))).toFixed(2)} dBFS (ceiling ${CEILING})`,
);

const out = join(ROOT, "out", "soundtrack.wav");
mkdirSync(dirname(out), { recursive: true });
writeWav(out, [L, R], SR);
const m4a = join(ROOT, "out", "soundtrack.m4a");
const ogg = join(ROOT, "out", "soundtrack.ogg");
for (const [file, codec] of [
  [m4a, ["-c:a", "aac", "-b:a", "192k"]],
  [ogg, ["-c:a", "libopus", "-b:a", "128k"]],
]) {
  const encode = spawnSync(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-i", out, ...codec, file],
    { stdio: "inherit" },
  );
  if (encode.status !== 0) throw new Error(`ffmpeg could not encode ${file}`);
}
console.log(`wrote ${out}, ${m4a}, and ${ogg} (${(frames / SR).toFixed(1)} s)`);
