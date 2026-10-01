// Render the soundtrack's synthesized chapters (everything except the finale, which is
// played by Sway's own synth in a browser; see finale.mjs).
//
//   node audio/render.mjs                    -> out/eras.wav (stereo float, 48 kHz)
//   node audio/render.mjs --to 100           render only the first 100 s (faster)
//   node audio/render.mjs --gain -2          master trim in dB

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DURATION, SR, atBar, byId, chapters } from "../src/timeline.js";
import { Mixer } from "./mixer.js";
import {
  compress,
  dB,
  limit,
  loudness,
  smoothstep,
  varispeed,
  filter,
} from "./dsp.js";
import { analogEras, tapeMachine, waxCylinder } from "./eras.js";
import { digitalEras } from "./digital.js";
import { writeWav } from "./wav.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const limitTo = Number(option("to", DURATION));
const masterGain = Number(option("gain", 0));
const outPath = resolve(ROOT, option("out", "out/eras.wav"));
mkdirSync(dirname(outPath), { recursive: true });

const tail = 6;
const mixer = new Mixer(Math.min(limitTo, DURATION) + tail);
const started = Date.now();
const lap = (label) =>
  console.log(
    `${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s  ${label}`,
  );

for (const era of [...analogEras, ...digitalEras]) {
  era(mixer);
  lap(`composed ${era.name}`);
}

mixer.runDeferred();
lap("processed stems");

// Medium processing: each era's recording chain acts on its own stem.
const stems = mixer.stems;
if (stems.wax)
  stems.wax.bus.region(byId.record.start - 1, atBar(24) + 0.6, waxCylinder);
if (stems.tape) {
  const from = atBar(24) - 0.6;
  const to = atBar(28) + 0.4;
  stems.tape.bus.region(from, to, (L, R) => {
    const out = tapeMachine(L, R);
    // The tape stops at the end of the chapter: speed falls away over the last second.
    const stopAt = atBar(28) - from - 0.7;
    const rate = (t) =>
      t < stopAt ? 1 : Math.max(0, 1 - (t - stopAt) / 0.75) ** 1.7;
    return { L: varispeed(out.L, rate), R: varispeed(out.R, rate) };
  });
}
lap("applied era media");

const mix = mixer.finish();
lap("reverbs and echoes");

// Balance the chapters: each is scaled toward a target loudness (a quiet opening that
// builds toward the produced track, a dip for the machine's loops), crossfading at the
// bar lines so nothing steps.
const TARGETS = {
  vibrate: -23,
  write: -21,
  repeat: -21,
  record: -20,
  electrify: -20,
  control: -19,
  count: -18.5,
  connect: -17,
  assemble: -15.5,
  delegate: -22.5,
};
const gains = chapters
  .filter(
    (c) => TARGETS[c.id] !== undefined && c.start < Math.min(limitTo, DURATION),
  )
  .map((c) => {
    const measured = loudness(mix.L, mix.R, c.start, Math.min(c.end, limitTo));
    const gain = Math.max(-14, Math.min(14, TARGETS[c.id] - measured));
    console.log(
      `  ${c.id.padEnd(10)} measured ${measured.toFixed(1)} LUFS -> ${gain >= 0 ? "+" : ""}${gain.toFixed(1)} dB`,
    );
    return { start: c.start, end: c.end, gain };
  });
const FADE = 1.2;
const curve = (t) => {
  let db = gains[0]?.gain ?? 0;
  for (let i = 1; i < gains.length; i++)
    db +=
      (gains[i].gain - gains[i - 1].gain) *
      smoothstep((t - (gains[i].start - FADE / 2)) / FADE);
  return db;
};
for (let i = 0; i < mix.L.length; i++) {
  if (i % 240 === 0) var g = dB(curve(i / SR));
  mix.L[i] *= g;
  mix.R[i] *= g;
}
lap("balanced chapters");

// Master: remove sub-rumble, glue, and catch peaks.
filter(mix.L, "highpass", 28, 0.7);
filter(mix.R, "highpass", 28, 0.7);
compress(mix.L, mix.R, {
  threshold: -20,
  ratio: 2.2,
  attack: 0.02,
  release: 0.3,
  knee: 8,
  makeup: 2,
});
const trim = dB(masterGain);
for (let i = 0; i < mix.L.length; i++) {
  mix.L[i] *= trim;
  mix.R[i] *= trim;
}
limit(mix.L, mix.R, { ceiling: -1.5 });
lap("mastered");

const end = Math.min(
  mix.L.length,
  Math.round((Math.min(limitTo, DURATION) + tail) * SR),
);
writeWav(outPath, [mix.L.subarray(0, end), mix.R.subarray(0, end)], SR);
lap(`wrote ${outPath} (${(end / SR).toFixed(1)} s)`);
