// The soundtrack, era by era. One tune (src/score.js) is re-performed in each chapter on
// that era's instruments and through that era's recording medium. Times are film seconds
// from src/timeline.js, so every sound lands where the picture expects it.

import { applySwing } from "../../web/instrument/clock.js";
import { WORLD } from "../../web/instrument/theory.js";
import { BAR, BEAT, atBar, byId } from "../src/timeline.js";
import { MOTIF, cues, chordOfBar, motif } from "../src/score.js";
import { SR, Biquad, filter, reversed, rng, saturate, wobble } from "./dsp.js";
import * as I from "./instruments.js";
import { Bus } from "./mixer.js";

const cache = new Map();
/** Render a voice once per key; identical hits reuse the buffer. */
const voice = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

const local = (id, s) => byId[id].start + s;
const SWING = WORLD.swing;
/** Film time of a point `beat` quarter-notes after `bar`, with Sway's light swing on 16ths. */
const swung = (bar, beat) => applySwing(bar * 4 + beat, SWING) * BEAT;
const bassOf = (bar) => chordOfBar(bar).bass;

// ---------------------------------------------------------------------------------------
// 1. Vibrate: a string, pure ratios, then its own overtones.
export function vibrate(m) {
  const { open, pluck, intervals, harmonics } = cues.vibrate;
  // The open string rings until the bridge begins to move.
  const firstSlide = intervals[0].slide;
  m.put(I.string({ freq: open, dur: firstSlide - pluck, decay: 4.2, vel: 0.95, release: 0.3, seed: 1 }), pluck, { gain: 0.95, pan: -0.05, hall: 0.55 });
  for (const [i, iv] of intervals.entries()) {
    // A bridge at length L sounds at open / L: octave (1/2), fifth (2/3), fourth (3/4).
    const next = intervals[i + 1]?.slide ?? harmonics[0].t;
    m.put(I.string({ freq: open / iv.length, dur: next - iv.pluck, decay: 3, vel: 0.9, bright: 1.15, release: 0.3, seed: 10 + i }), iv.pluck, { gain: 0.9, pan: 0.05 * (i - 1), hall: 0.6 });
  }
  // The overtones, one by one: harmonics 1, 2, 3, 4, 6 of the open string.
  for (const [i, h] of harmonics.entries()) {
    if (i === 0) m.put(I.string({ freq: open, dur: 5, decay: 3.4, vel: 0.8, release: 1.2, seed: 40 }), h.t, { gain: 0.8, hall: 0.6 });
    else m.put(I.sineBell({ freq: open * h.n, dur: 3, vel: 0.9, decay: 1.4 }), h.t, { gain: 0.62 - i * 0.04, pan: -0.3 + 0.15 * i, hall: 0.7 });
  }
}

// ---------------------------------------------------------------------------------------
// 2. Write: plainchant in parallel fifths over a drone, in a stone room.
export function write(m) {
  const t0 = local("write", -1.8);
  for (const [midi, gain] of [[45, 0.5], [52, 0.34]]) {
    m.put(I.pipe({ midi, dur: 16.2, vel: 0.5, vibrato: 0.001, seed: midi }), t0, { gain, hall: 0.9 });
  }
  // The last second: a crank winds a spring (ratchet clicks speeding up) into the next machine.
  const click = voice("winder", () => {
    const r = rng(88);
    const out = new Float32Array(Math.round(0.02 * SR));
    const bp = new Biquad("bandpass", 1800, 1.4);
    for (let i = 0; i < out.length; i++) out[i] = bp.tick(r() * 2 - 1) * Math.exp(-i / SR / 0.003);
    return out;
  });
  let t = local("write", 12.6);
  for (let gap = 0.16; t < byId.repeat.start - 0.02; gap = Math.max(0.035, gap * 0.9)) {
    m.put(click, t, { gain: 0.12, pan: -0.3 });
    t += gap;
  }
  const parallel = { 69: 62, 72: 65, 76: 69, 74: 67, 67: 60 }; // a fifth below, on the white notes
  for (const note of cues.write.notes) {
    const dur = Math.max(0.5, note.dur * 1.05);
    m.put(I.pipe({ midi: note.midi, dur, vel: 0.85, seed: 100 + note.index }), note.t, { gain: 0.8, pan: 0.1, hall: 1.0 });
    m.put(I.pipe({ midi: parallel[note.midi], dur, vel: 0.7, seed: 200 + note.index }), note.t, { gain: 0.46, pan: -0.15, hall: 1.0 });
  }
}

// ---------------------------------------------------------------------------------------
// Shared: the oom-pah of a player piano, and the motif's lines.
function pianolaBar(m, bar, { vel = 0.7, stem = null, gain = 1, hall = 0.2, room = 0.1 } = {}) {
  const chord = chordOfBar(bar);
  const bass = chord.bass + 12;
  const root = atBar(bar);
  const tones = chord.pad.slice(1);
  const hit = (midi, beat, dur, v, honky = 4) =>
    m.put(voice(`pn${midi}-${dur}-${v}`, () => I.piano({ midi, vel: v, dur, honky })), root + beat * BEAT, { gain, pan: -0.15, stem, hall, room });
  hit(bass, 0, 0.45, vel);
  hit(bass + 7, 2, 0.45, vel * 0.85);
  for (const beat of [1, 3]) for (const tone of tones) hit(tone, beat, 0.4, vel * 0.5);
}

function pianolaMelody(m, startBar, from, to, opts = {}) {
  const { vel = 0.8, stem = null, gain = 1, hall = 0.2, room = 0.1, box = true, boxGain = 0.5, shift = 0 } = opts;
  for (const note of motif(startBar, { from, to })) {
    const midi = note.midi + shift;
    m.put(voice(`pm${midi}-${note.dur.toFixed(2)}`, () => I.piano({ midi, vel, dur: note.dur * 0.95, honky: 4 })), note.t, { gain, pan: 0.1, stem, hall, room });
    if (box)
      m.put(voice(`mb${midi + 12}`, () => I.musicBox({ midi: midi + 12, vel: 0.75 })), note.t, { gain: boxGain, pan: 0.3, stem, hall: hall * 1.2, room });
  }
}

/** A quiet escapement tick on every beat: the grid arrives as a machine's meter. */
function ticks(m, fromBar, toBar, gain = 0.1) {
  const tick = voice("tick", () => {
    const r = rng(77);
    const out = new Float32Array(Math.round(0.03 * SR));
    const bp = new Biquad("bandpass", 2600, 1.3);
    for (let i = 0; i < out.length; i++) out[i] = bp.tick(r() * 2 - 1) * Math.exp(-i / SR / 0.004);
    return out;
  });
  for (let b = fromBar * 4; b < toBar * 4; b++) m.put(tick, b * BEAT, { gain: gain * (b % 4 === 0 ? 1.3 : 0.8), pan: 0.4 });
}

// ---------------------------------------------------------------------------------------
// 3. Repeat: a pinned cylinder, then a paper roll.
export function repeat(m) {
  // Bars 14-15: the cylinder plays the first half of the tune; bars 16-17 again (the repeat),
  // with a pulse of ticks; bars 18-19 the player piano takes over the second half.
  for (const bar of [14, 16]) {
    for (const note of motif(bar, { from: 0, to: 8 }))
      m.put(voice(`mb${note.midi + 12}`, () => I.musicBox({ midi: note.midi + 12, vel: 0.75 })), note.t, { gain: 0.75, pan: 0.15, hall: 0.4, room: 0.15 });
  }
  // The cylinder's own low pins: a root and fifth under each bar.
  for (const bar of [14, 15, 16, 17]) {
    const root = chordOfBar(bar).bass + 24;
    for (const [beat, semis] of [[0, 0], [2, 7]])
      m.put(voice(`mb${root + semis}`, () => I.musicBox({ midi: root + semis, vel: 0.7 })), atBar(bar, beat), { gain: 0.5, pan: -0.25, hall: 0.3, room: 0.15 });
  }
  ticks(m, 14, 20, 0.12);
  // The roll begins: second half of the tune, left hand and right.
  pianolaMelody(m, 16, 8, 16, { vel: 0.8, gain: 0.95, boxGain: 0.4 });
  for (const bar of [18, 19]) pianolaBar(m, bar, { vel: 0.7, gain: 0.8 });
  // Pneumatic breath: the roll's valves open on each note.
  const huff = voice("huff", () => {
    const r = rng(81);
    const out = new Float32Array(Math.round(0.09 * SR));
    for (let i = 0; i < out.length; i++) out[i] = (r() * 2 - 1) * Math.exp(-i / SR / 0.025) * Math.min(1, i / 80);
    filter(out, "bandpass", 1500, 0.8);
    return out;
  });
  for (const note of motif(16, { from: 8, to: 16 })) m.put(huff, note.t - 0.01, { gain: 0.1, pan: 0.2 });
}

// ---------------------------------------------------------------------------------------
// 4. Record: the same tune, heard through a horn and then from tape.

/** The old-recording filter: a horn's narrow band, saturation, wobble, crackle. */
export function waxCylinder(L, R) {
  const n = L.length;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = (L[i] + R[i]) * 0.5;
  filter(mono, "highpass", 320, 0.9);
  filter(mono, "highpass", 320, 0.9);
  filter(mono, "lowpass", 2600, 0.9);
  filter(mono, "lowpass", 2900, 0.7);
  filter(mono, "peaking", 1250, 1.6, 8);
  saturate(mono, 2.4, 1);
  const wobbled = wobble(mono, { wow: 0.007, wowRate: 0.55, flutter: 0.002, flutterRate: 6.5, seed: 5 });
  const surface = I.crackle({ dur: n / SR, density: 26, level: 0.5, bed: 0.022, seed: 33 });
  for (let i = 0; i < n; i++) wobbled[i] = wobbled[i] * 1.0 + surface[i] * 0.3;
  return { L: wobbled, R: Float32Array.from(wobbled) };
}

/** Reel-to-reel tape: a gentle head bump, rolled-off highs, mild saturation, hiss. */
export function tapeMachine(L, R, { hissLevel = 0.008, flutter = 0.0012 } = {}) {
  const out = {};
  for (const [key, ch, seed] of [["L", L, 6], ["R", R, 7]]) {
    const x = Float32Array.from(ch);
    filter(x, "highpass", 38, 0.7);
    filter(x, "peaking", 90, 1, 2.2);
    filter(x, "lowpass", 12500, 0.7);
    saturate(x, 1.35, 1);
    const w = wobble(x, { wow: 0.0012, wowRate: 0.7, flutter, flutterRate: 6.2, seed });
    const h = I.hiss({ dur: x.length / SR, level: hissLevel, seed: 50 + seed });
    for (let i = 0; i < w.length; i++) w[i] += h[i];
    out[key] = w;
  }
  return out;
}

export function record(m) {
  const start = byId.record.start;
  const cylinder = "wax";
  // Needle drop and the horn-era statement (bars 20-23).
  const thump = voice("thump", () => {
    const out = new Float32Array(Math.round(0.25 * SR));
    for (let i = 0; i < out.length; i++) out[i] = Math.sin(2 * Math.PI * 62 * (i / SR)) * Math.exp(-i / SR / 0.05) * Math.min(1, i / 40);
    return out;
  });
  m.put(thump, start - 0.1, { gain: 0.5, stem: cylinder });
  pianolaMelody(m, 20, 0, 16, { vel: 0.85, gain: 1, stem: cylinder, boxGain: 0.45, hall: 0, room: 0 });
  for (const bar of [20, 21, 22, 23]) pianolaBar(m, bar, { vel: 0.72, gain: 0.9, stem: cylinder, hall: 0, room: 0 });
  m.stem(cylinder).bus.add(I.crackle({ dur: 10.4, density: 22, level: 0.4, bed: 0.03, seed: 34 }), start - 0.4, { gain: 0.5 });

  // Tape-era statement (bars 24-27): wider and warmer, with a reversed swell and a tape stop.
  const tape = "tape";
  const taped = (note) => voice(`pt${note.midi}-${note.dur.toFixed(2)}`, () => I.piano({ midi: note.midi, vel: 0.85, dur: note.dur * 0.95, honky: 1.5 }));
  for (const note of motif(24)) m.put(taped(note), note.t, { gain: 0.95, pan: 0.05, stem: tape, hall: 0.35, room: 0.15 });
  for (const bar of [24, 25, 26, 27]) pianolaTape(m, bar, tape);
  // A reversed chord swells into the last bar: render it forward, flip it, land its peak on the bar line.
  const swell = new Bus(Math.round(2.4 * SR));
  for (const midi of [55, 60, 64, 67, 72])
    swell.add(voice(`sw${midi}`, () => I.piano({ midi, vel: 0.8, dur: 0.4, honky: 1.5 })), 0, { gain: 0.5, pan: (midi % 5) * 0.1 - 0.2 });
  m.put({ L: reversed(swell.L), R: reversed(swell.R) }, atBar(27) - 2.4, { gain: 0.8, stem: tape, hall: 0.3 });
  // The scissors: a snip before the loop (the picture cuts the tape at the same moment).
  m.put(voice("snip", () => I.hat({ vel: 0.9, seed: 3 })), atBar(26, 1.5), { gain: 0.5, stem: tape, pan: 0.3 });
  m.stem(tape).bus.add(I.hiss({ dur: BAR * 8 + 1, level: 0.006, seed: 60 }), atBar(24), { gain: 1 });
}

function pianolaTape(m, bar, stem) {
  const chord = chordOfBar(bar);
  const bass = chord.bass + 12;
  const root = atBar(bar);
  const tones = chord.pad.slice(1);
  const hit = (midi, beat, dur, v) => m.put(voice(`pt${midi}-${dur}-${v}`, () => I.piano({ midi, vel: v, dur, honky: 1.5 })), root + beat * BEAT, { gain: 0.8, pan: -0.2, stem, hall: 0.3, room: 0.12 });
  hit(bass, 0, 0.9, 0.75);
  hit(bass + 7, 2, 0.9, 0.65);
  for (const beat of [1, 3]) for (const tone of tones) hit(tone, beat, 0.6, 0.38);
}

// ---------------------------------------------------------------------------------------
// 5. Electrify: a theremin over the hum of mains, then a drawbar organ.
export function electrify(m) {
  const { drawbars } = cues.electrify;
  // Mains hum, tuned to A.
  m.put(I.hum({ dur: BAR * 8 + 2, level: 0.5 }), atBar(28) - 0.8, { gain: 0.05, pan: 0 });
  m.put(I.crackle({ dur: BAR * 8 + 1, density: 6, level: 0.25, bed: 0.004, seed: 41 }), atBar(28), { gain: 0.25 });
  for (const bar of [28, 32]) {
    const notes = MOTIF.map(([beat, midi, beats]) => ({ t: beat * BEAT, dur: beats * BEAT * 0.97, midi }));
    const phrase = I.theremin({ notes, vel: 0.85, seed: bar });
    m.put(phrase, atBar(bar), { gain: bar === 28 ? 0.95 : 0.78, pan: bar === 28 ? 0 : 0.15, hall: 0.55, room: 0.1 });
  }
  // The organ joins in bar 32 on half-bar chords; each pull of a drawbar lands on one.
  const levelsAt = (t) => {
    const bars = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const pull of drawbars) if (pull.t <= t + 0.01) bars[pull.i] = pull.level;
    return bars;
  };
  for (let bar = 32; bar < 36; bar++) {
    const chord = chordOfBar(bar);
    for (const half of [0, 2]) {
      const t = atBar(bar, half);
      const registration = levelsAt(t);
      for (const midi of chord.pad) {
        const key = `org${midi}-${registration.join("")}`;
        m.put(voice(key, () => I.organ({ midi, dur: 2 * BEAT * 1.02, drawbars: registration, vel: 0.62 })), t, { gain: 0.46, hall: 0.35, room: 0.1 });
      }
    }
  }
  // A last beat of pickup: the voltage era's first bass note, a bar early.
  m.put(I.moog({ midi: 33, dur: BEAT * 0.9, vel: 0.85, cutoff: 260, envAmount: 900 }), atBar(35, 3), { gain: 0.55, pan: 0, room: 0.05 });
}

// ---------------------------------------------------------------------------------------
// 6. Control: a sequenced Moog, its filter opening as a knob turns.
export function control(m) {
  const start = atBar(36);
  const knob = (t) => Math.min(1, Math.max(0, (t - start) / (BAR * 4)));
  const stem = "moog";
  // Bass: eighth-note sequence on each bar's root, octave jumps on the off-beats.
  for (let bar = 36; bar < 40; bar++) {
    const root = bassOf(bar) + 12; // an octave above Sway's low bass, so small speakers carry it
    for (let step = 0; step < 8; step++) {
      const t = atBar(bar, step / 2);
      const open = knob(t);
      const midi = step % 4 === 2 ? root + 12 : root;
      m.put(voice(`mg${midi}-${Math.round(open * 12)}`, () => I.moog({ midi, dur: BEAT * 0.4, vel: 0.85, cutoff: 220 + 1500 * open, envAmount: 700 + 2400 * open, envDecay: 0.14, resonance: 0.45 + 0.35 * open, sub: 0.6 })), t, { gain: 0.62, stem, pan: -0.1 });
    }
  }
  // Lead: the tune on a glided saw, brighter as the knob opens.
  for (const note of motif(36)) {
    const open = knob(note.t);
    m.put(voice(`ml${note.midi}-${note.dur.toFixed(2)}-${Math.round(open * 8)}`, () => I.moog({ midi: note.midi, dur: note.dur * 0.92, vel: 0.9, cutoff: 700 + 900 * open, envAmount: 2200 + 1800 * open, envDecay: 0.4, resonance: 0.4, sub: 0.15, pulse: 0.7, glideFrom: note.midi - 2 })), note.t, { gain: 0.5, stem, pan: 0.1, echo: 0.22, room: 0.1 });
  }
  // From bar 38, a sequencer figure in sixteenths: the chord's tones, rising.
  for (let bar = 38; bar < 40; bar++) {
    const chord = chordOfBar(bar);
    const tones = [...chord.pad].sort((a, b) => a - b);
    for (let step = 0; step < 16; step++) {
      const midi = tones[[0, 1, 2, 3, 2, 1, 3, 2][step % 8]] + 12;
      m.put(voice(`sq${midi}`, () => I.blip({ midi, vel: 0.6, dur: 0.12, cutoff: 3200 })), atBar(bar, step / 4), { gain: 0.2, pan: 0.35, stem, echo: 0.45 });
    }
  }
}

// ---------------------------------------------------------------------------------------
export const analogEras = [vibrate, write, repeat, record, electrify, control];
export { voice, swung, local };
