// The soundtrack's instruments, one synthesis method per era. Each function renders a
// single sound into a Float32Array (mono) or a { L, R } pair, ready for the mixer. Nominal
// peaks are about 0.5 at full velocity; the mixer sets the balance.

import {
  Biquad,
  Osc,
  SR,
  TAU,
  clamp,
  fade,
  filter,
  ladder,
  mtof,
  noise,
  normalize,
  peak,
  rng,
  samples,
  saturate,
  smoothstep,
} from "./dsp.js";

const env = (t, tau) => Math.exp(-t / tau);

// ---------------------------------------------------------------- chapter 1: string

/** An idealized plucked string: harmonic partials with pluck-position comb and faster-fading highs. */
export function string({
  freq,
  dur = 3,
  vel = 0.8,
  decay = 2.6,
  bright = 1,
  pos = 0.17,
  release = 0.05,
  seed = 1,
}) {
  const n = samples(dur);
  const out = new Float32Array(n);
  const partials = Math.min(16, Math.floor(10000 / freq));
  for (let h = 1; h <= partials; h++) {
    const amp =
      (Math.abs(Math.sin(Math.PI * h * pos)) + 0.08) / h ** (1.25 / bright);
    const tau = decay / h ** 0.75;
    const w = (TAU * freq * h) / SR;
    for (let i = 0; i < n; i++)
      out[i] += amp * Math.sin(w * i) * Math.exp(-i / SR / tau);
  }
  // The pluck itself: a few milliseconds of darkened noise.
  const r = rng(seed);
  const tick = new Biquad("bandpass", Math.min(4000, freq * 6), 1.2);
  for (let i = 0; i < Math.min(n, samples(0.012)); i++)
    out[i] += tick.tick(r() * 2 - 1) * 0.35 * Math.exp(-i / SR / 0.003);
  for (let i = 0; i < Math.min(n, 96); i++) out[i] *= i / 96;
  normalize(out, 0.55 * vel);
  return fade(out, 0, release);
}

/** A soft sine bell, for overtones and sparkle. */
export function sineBell({ freq, dur = 2.4, vel = 0.6, decay = 1.1 }) {
  const n = samples(dur);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] =
      Math.sin(TAU * freq * t) * env(t, decay) +
      0.18 * Math.sin(TAU * freq * 2.001 * t) * env(t, decay * 0.5) +
      0.05 * Math.sin(TAU * freq * 3.003 * t) * env(t, decay * 0.3);
  }
  for (let i = 0; i < Math.min(n, 120); i++) out[i] *= i / 120;
  normalize(out, 0.5 * vel);
  return fade(out, 0, 0.1);
}

// ---------------------------------------------------------------- chapter 2: pipe organ

/** A flute-like organ pipe with a breath of chiff, for the chant. */
export function pipe({ midi, dur = 1, vel = 0.7, vibrato = 0.0025, seed = 5 }) {
  const f = mtof(midi);
  const total = dur + 0.4;
  const n = samples(total);
  const out = new Float32Array(n);
  const attack = 0.05;
  const release = 0.22;
  const amps = [1, 0.42, 0.26, 0.13, 0.07, 0.035];
  let phase = 0;
  const r = rng(seed);
  const breath = new Biquad("bandpass", 2800, 2.2);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const vib =
      1 + vibrato * Math.sin(TAU * 4.6 * t) * smoothstep((t - 0.25) / 0.5);
    phase += (TAU * f * vib) / SR;
    let s = 0;
    for (let h = 0; h < amps.length; h++)
      s += amps[h] * Math.sin(phase * (h + 1));
    const a = clamp(t / attack);
    const rel = t > dur ? Math.exp(-(t - dur) / (release / 3)) : 1;
    const chiff =
      breath.tick(r() * 2 - 1) * 0.05 * Math.exp(-t / 0.05) +
      breath.tick(r() * 2 - 1) * 0.004;
    out[i] = (s * 0.22 + chiff) * a * rel;
  }
  normalize(out, 0.45 * vel);
  return fade(out, 0, 0.05);
}

// ---------------------------------------------------------------- chapter 3: pins and rolls

/** A music-box tine: a struck cantilever with inharmonic upper partials and a pin tick. */
export function musicBox({ midi, vel = 0.7, dur = 1.6, seed = 2 }) {
  const f = mtof(midi);
  const n = samples(dur);
  const out = new Float32Array(n);
  const tau1 = clamp(1.7 - (midi - 60) * 0.035, 0.45, 1.7);
  const parts = [
    [1, 1, tau1],
    [6.267, 0.32, 0.16],
    [17.55, 0.08, 0.05],
  ];
  for (const [ratio, amp, tau] of parts) {
    const fr = f * ratio;
    if (fr > 14000) continue;
    const w = (TAU * fr) / SR;
    for (let i = 0; i < n; i++)
      out[i] += amp * Math.sin(w * i) * Math.exp(-i / SR / tau);
  }
  const r = rng(seed);
  const tick = new Biquad("highpass", 2500);
  for (let i = 0; i < Math.min(n, samples(0.004)); i++)
    out[i] += tick.tick(r() * 2 - 1) * 0.12 * Math.exp(-i / SR / 0.0012);
  for (let i = 0; i < Math.min(n, 60); i++) out[i] *= i / 60;
  normalize(out, 0.42 * vel);
  return fade(out, 0, 0.03);
}

/**
 * A piano after Weinreich/Fletcher: three slightly detuned strings, stretched partials, a
 * hammer comb, register-dependent decay. `honky` detunes the unison for a player-piano tack.
 */
export function piano({ midi, vel = 0.7, dur = 1, honky = 0, seed = 3 }) {
  const f0 = mtof(midi);
  const ringing = clamp(3.4 - (midi - 36) * 0.03, 0.7, 3.6);
  const total = dur + 0.5;
  const n = samples(total);
  const out = new Float32Array(n);
  const B = 0.00015 * 2 ** ((midi - 60) / 14);
  const detunes = honky ? [-honky, 0.4, honky] : [-1.2, 0, 1.2];
  const partials = Math.min(22, Math.floor(11000 / f0));
  const strike = 0.12;
  for (const cents of detunes) {
    const f = f0 * 2 ** (cents / 1200);
    for (let h = 1; h <= partials; h++) {
      const fh = f * h * Math.sqrt(1 + B * h * h);
      if (fh > 14000) break;
      const bright = h > 3 ? vel ** 1.4 : 1;
      const amp =
        ((Math.abs(Math.sin(Math.PI * h * strike)) + 0.05) / h ** 0.95) *
        bright;
      const tau =
        (ringing / (1 + 0.55 * h)) * (cents === detunes[1] ? 1 : 0.85);
      const w = (TAU * fh) / SR;
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        const rel = t > dur ? Math.exp(-(t - dur) / 0.07) : 1;
        out[i] += amp * Math.sin(w * i) * Math.exp(-t / tau) * rel;
      }
    }
  }
  const r = rng(seed + midi);
  const thump = new Biquad("lowpass", 700);
  const click = new Biquad("bandpass", 3200, 1);
  for (let i = 0; i < Math.min(n, samples(0.03)); i++) {
    const w = r() * 2 - 1;
    out[i] +=
      (thump.tick(w) * 0.5 + click.tick(w) * (honky ? 0.7 : 0.15)) *
      vel *
      Math.exp(-i / SR / 0.008);
  }
  for (let i = 0; i < Math.min(n, 48); i++) out[i] *= i / 48;
  normalize(out, 0.55 * vel);
  return fade(out, 0, 0.04);
}

// ---------------------------------------------------------------- chapter 5: electric

/**
 * A theremin phrase. `notes` are { t, dur, midi } with t in seconds from the start of the
 * returned buffer; pitch glides between notes the way a hand moves, with a late vibrato.
 */
export function theremin({ notes, vel = 0.7, glide = 0.11, seed = 9 }) {
  const end = Math.max(...notes.map((x) => x.t + x.dur)) + 0.4;
  const n = samples(end);
  const out = new Float32Array(n);
  const pitchAt = (t) => {
    let current = notes[0];
    for (const note of notes) if (note.t <= t) current = note;
    const index = notes.indexOf(current);
    const previous = notes[index - 1];
    if (
      previous &&
      t - current.t < glide &&
      current.t - (previous.t + previous.dur) < 0.12
    ) {
      const u = smoothstep((t - current.t) / glide);
      return previous.midi + (current.midi - previous.midi) * u;
    }
    return current.midi;
  };
  const ampAt = (t) => {
    let a = 0;
    for (const note of notes) {
      const local = t - note.t;
      if (local < -0.02) continue;
      const rise = clamp((local + 0.02) / 0.07);
      const fall = local > note.dur ? Math.exp(-(local - note.dur) / 0.05) : 1;
      a = Math.max(a, rise * fall);
    }
    return a;
  };
  let phase = 0;
  const r = rng(seed);
  const tone = new Biquad("lowpass", 3200, 0.7);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let current = notes[0];
    for (const note of notes) if (note.t <= t) current = note;
    const sinceOnset = t - current.t;
    const vibrato =
      1 +
      0.0048 * Math.sin(TAU * 5.7 * t) * smoothstep((sinceOnset - 0.2) / 0.45);
    const drift = 1 + 0.0007 * Math.sin(TAU * 0.37 * t + 1);
    const f = mtof(pitchAt(t)) * vibrato * drift;
    phase += (TAU * f) / SR;
    const s =
      Math.sin(phase) + 0.13 * Math.sin(2 * phase) + 0.05 * Math.sin(3 * phase);
    out[i] = tone.tick(s + (r() * 2 - 1) * 0.004) * ampAt(t);
  }
  normalize(out, 0.5 * vel);
  return fade(out, 0.02, 0.1);
}

/**
 * A tonewheel organ: nine sine drawbars at the footages 16', 5 1/3', 8', 4', 2 2/3', 2',
 * 1 3/5', 1 1/3', 1' (levels 0 to 8 each), a key click, and a rotating-speaker shimmer.
 */
export const DRAWBAR_RATIOS = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8];
export function organ({
  midi,
  dur = 1,
  drawbars = [0, 0, 8, 0, 0, 0, 0, 0, 0],
  vel = 0.7,
  speaker = 0.18,
  seed = 4,
}) {
  const f = mtof(midi);
  const total = dur + 0.15;
  const n = samples(total);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const levels = drawbars.map((d) => (d <= 0 ? 0 : 10 ** (((d - 8) * 3) / 20)));
  const norm =
    1 /
    Math.max(
      1,
      levels.reduce((a, b) => a + b, 0),
    );
  const r = rng(seed + midi);
  const click = new Biquad("bandpass", 2400, 0.8);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s = 0;
    for (let k = 0; k < 9; k++)
      if (levels[k] && f * DRAWBAR_RATIOS[k] < 15000)
        s += levels[k] * Math.sin(TAU * f * DRAWBAR_RATIOS[k] * t);
    const a =
      Math.min(1, t / 0.006) * (t > dur ? Math.exp(-(t - dur) / 0.03) : 1);
    const keyclick = click.tick(r() * 2 - 1) * 0.1 * Math.exp(-t / 0.004);
    const v = (s * norm + keyclick) * a;
    // Rotating speaker: opposite-phase amplitude shimmer on each side.
    L[i] = v * (1 + speaker * Math.sin(TAU * 6.1 * t));
    R[i] = v * (1 + speaker * Math.sin(TAU * 6.1 * t + Math.PI));
  }
  const p = Math.max(peak(L), peak(R));
  const g = (0.4 * vel) / (p || 1);
  for (let i = 0; i < n; i++) {
    L[i] *= g;
    R[i] *= g;
  }
  return { L: fade(L, 0, 0.02), R: fade(R, 0, 0.02) };
}

// ---------------------------------------------------------------- chapter 6: voltage

/** A subtractive voice: saw + pulse + sub into a resonant ladder filter with its own envelope. */
export function moog({
  midi,
  dur = 0.5,
  vel = 0.8,
  cutoff = 500,
  envAmount = 3000,
  envDecay = 0.25,
  resonance = 0.55,
  sub = 0.5,
  pulse = 0.4,
  glideFrom = null,
}) {
  const total = dur + 0.25;
  const n = samples(total);
  const out = new Float32Array(n);
  const saw = new Osc(0.1);
  const pul = new Osc(0.6);
  const sin = new Osc();
  const f = mtof(midi);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const fi =
      glideFrom === null
        ? f
        : mtof(glideFrom + (midi - glideFrom) * smoothstep(t / 0.06));
    const s =
      saw.saw(fi) * 0.55 +
      pul.pulse(fi * 1.003, 0.35) * pulse * 0.5 +
      sin.sine(fi * 0.5) * sub * 0.6;
    const a =
      Math.min(1, t / 0.004) * (t > dur ? Math.exp(-(t - dur) / 0.06) : 1);
    out[i] = s * a;
  }
  ladder(
    out,
    (i) => cutoff + envAmount * vel * Math.exp(-i / SR / envDecay),
    resonance,
    1.4,
  );
  normalize(out, 0.6 * vel);
  return fade(out, 0, 0.03);
}

// ---------------------------------------------------------------- chapter 7: digital

/** A DX-style electric piano: two 2-operator pairs, a bell-like tine and a mellow body. */
export function fmPiano({ midi, vel = 0.7, dur = 1 }) {
  const f = mtof(midi);
  const total = dur + 0.6;
  const n = samples(total);
  const out = new Float32Array(n);
  const tau = clamp(2.2 - (midi - 48) * 0.02, 0.5, 2.4);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const body = Math.sin(
      TAU * f * t + (0.9 + 2.2 * vel) * env(t, 0.55) * Math.sin(TAU * f * t),
    );
    const tine =
      Math.sin(
        TAU * f * t + 2.6 * vel * env(t, 0.05) * Math.sin(TAU * f * 14 * t),
      ) *
      0.28 *
      env(t, 0.22);
    const a = env(t, tau) * (t > dur ? Math.exp(-(t - dur) / 0.12) : 1);
    out[i] = (body + tine) * a * Math.min(1, t / 0.002);
  }
  normalize(out, 0.5 * vel);
  return fade(out, 0, 0.05);
}

/** An inharmonic FM bell (carrier : modulator = 1 : 3.5). */
export function fmBell({
  midi,
  vel = 0.6,
  dur = 2.4,
  ratio = 3.5,
  index = 3.2,
}) {
  const f = mtof(midi);
  const n = samples(dur);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] =
      Math.sin(
        TAU * f * t + index * env(t, 0.7) * Math.sin(TAU * f * ratio * t),
      ) *
      env(t, 1.15) *
      Math.min(1, t / 0.002);
  }
  normalize(out, 0.5 * vel);
  return fade(out, 0, 0.1);
}

/** A short pitched blip: a square-ish pluck for the digital arpeggio. */
export function blip({ midi, vel = 0.7, dur = 0.18, cutoff = 2800 }) {
  const n = samples(dur + 0.1);
  const out = new Float32Array(n);
  const o = new Osc();
  const f = mtof(midi);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] = o.pulse(f, 0.5) * env(t, dur * 0.7) * Math.min(1, t / 0.002);
  }
  filter(out, "lowpass", (i) => cutoff * (0.3 + 0.7 * env(i / SR, 0.08)), 1.2);
  normalize(out, 0.4 * vel);
  return fade(out, 0, 0.02);
}

// ---------------------------------------------------------------- chapter 8: drum machine

export function kick({
  vel = 0.9,
  tune = 48,
  decay = 0.42,
  sweep = 3.2,
  click = 0.25,
  drive = 1.6,
  seed = 6,
}) {
  const n = samples(decay * 3 + 0.1);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = tune * (1 + sweep * env(t, 0.022)) * (1 + 0.15 * env(t, 0.004));
    phase += (TAU * f) / SR;
    out[i] = Math.sin(phase) * env(t, decay) * Math.min(1, t / 0.0015);
  }
  const r = rng(seed);
  const hp = new Biquad("highpass", 1500);
  for (let i = 0; i < Math.min(n, samples(0.012)); i++)
    out[i] += hp.tick(r() * 2 - 1) * click * env(i / SR, 0.002);
  saturate(out, drive, 1);
  normalize(out, 0.8 * vel);
  return fade(out, 0, 0.02);
}

export function snare({ vel = 0.8, tone = 185, seed = 8 }) {
  const n = samples(0.4);
  const out = new Float32Array(n);
  const r = rng(seed);
  const band = new Biquad("bandpass", 3600, 0.7);
  const high = new Biquad("highpass", 1200);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const body =
      Math.sin(TAU * tone * t * (1 + 0.25 * env(t, 0.015))) * env(t, 0.07) +
      0.6 * Math.sin(TAU * tone * 1.78 * t) * env(t, 0.045);
    const hiss = high.tick(band.tick(r() * 2 - 1)) * env(t, 0.1) * 1.1;
    out[i] = body * 0.8 + hiss;
  }
  normalize(out, 0.7 * vel);
  return fade(out, 0, 0.05);
}

export function clap({ vel = 0.7, seed = 12 }) {
  const n = samples(0.4);
  const out = new Float32Array(n);
  const r = rng(seed);
  const band = new Biquad("bandpass", 1250, 1.3);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let a = 0;
    for (const offset of [0, 0.011, 0.023])
      if (t >= offset) a = Math.max(a, env(t - offset, 0.004));
    if (t >= 0.034) a = Math.max(a, 0.8 * env(t - 0.034, 0.08));
    out[i] = band.tick(r() * 2 - 1) * a;
  }
  normalize(out, 0.6 * vel);
  return fade(out, 0, 0.05);
}

const HAT_FREQS = [205.3, 304.4, 369.6, 522.7, 540, 800];
export function hat({ vel = 0.6, open = false, seed = 14 }) {
  const length = open ? 0.55 : 0.1;
  const n = samples(length);
  const out = new Float32Array(n);
  const r = rng(seed);
  const oscs = HAT_FREQS.map((f, i) => new Osc(i * 0.13));
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s = 0;
    for (let k = 0; k < 6; k++) s += oscs[k].pulse(HAT_FREQS[k] * 2.6, 0.5);
    out[i] =
      (s / 6 + (r() * 2 - 1) * 0.35) *
      env(t, open ? 0.14 : 0.022) *
      Math.min(1, t / 0.0006);
  }
  filter(out, "highpass", 7000, 0.8);
  filter(out, "peaking", 10200, 1.2, 4);
  normalize(out, 0.42 * vel);
  return fade(out, 0, open ? 0.08 : 0.02);
}

export function cowbell({ vel = 0.6 }) {
  const n = samples(0.4);
  const out = new Float32Array(n);
  const a = new Osc();
  const b = new Osc(0.3);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] =
      (a.pulse(540, 0.5) + b.pulse(800, 0.5)) *
      (0.4 * env(t, 0.03) + 0.6 * env(t, 0.16));
  }
  filter(out, "bandpass", 830, 1.6);
  normalize(out, 0.45 * vel);
  return fade(out, 0, 0.1);
}

export function shaker({ vel = 0.5, seed = 15 }) {
  const n = samples(0.14);
  const out = new Float32Array(n);
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] = (r() * 2 - 1) * Math.min(1, t / 0.012) * env(t, 0.03);
  }
  filter(out, "bandpass", 6200, 1.1);
  normalize(out, 0.32 * vel);
  return fade(out, 0, 0.03);
}

export function crash({ vel = 0.6, dur = 3, seed = 16 }) {
  const n = samples(dur);
  const out = new Float32Array(n);
  const r = rng(seed);
  for (let i = 0; i < n; i++)
    out[i] = (r() * 2 - 1) * env(i / SR, dur / 4.5) * Math.min(1, i / 60);
  filter(out, "highpass", 4200, 0.8);
  filter(out, "peaking", 7500, 0.8, 5);
  normalize(out, 0.4 * vel);
  return fade(out, 0, 0.3);
}

/** Filtered noise that sweeps up and swells: a riser into a downbeat. */
export function riser({
  dur = 2,
  vel = 0.6,
  from = 300,
  to = 8000,
  seed = 17,
}) {
  const n = samples(dur);
  const out = new Float32Array(n);
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    out[i] = (r() * 2 - 1) * u ** 2;
  }
  filter(out, "bandpass", (i) => from * (to / from) ** (i / n), 2.2);
  normalize(out, 0.5 * vel);
  return fade(out, 0.02, 0.01);
}

// ---------------------------------------------------------------- pads and bass

/** A warm detuned-saw pad chord, stereo-wide, with a slowly opening low-pass. */
export function pad({
  midis,
  dur = 2.4,
  vel = 0.7,
  bright = 0.4,
  attack = 0.5,
  release = 0.9,
  seed = 21,
}) {
  const total = dur + release * 1.5;
  const n = samples(total);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const r = rng(seed);
  for (const midi of midis) {
    const f = mtof(midi);
    for (const [cents, side] of [
      [-9, -1],
      [0, 0],
      [8, 1],
    ]) {
      const oscL = new Osc(r());
      const oscR = new Osc(r());
      const fd = f * 2 ** (cents / 1200);
      const gl = 0.5 - 0.25 * side;
      const gr = 0.5 + 0.25 * side;
      for (let i = 0; i < n; i++) {
        L[i] += oscL.saw(fd) * gl;
        R[i] += oscR.saw(fd * 1.0007) * gr;
      }
    }
  }
  const cutoff = (i) =>
    350 + 2600 * bright * (0.55 + 0.45 * smoothstep(i / SR / (attack * 2)));
  filter(L, "lowpass", cutoff, 0.6);
  filter(R, "lowpass", cutoff, 0.6);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const a =
      clamp(t / attack) * (t > dur ? Math.exp(-(t - dur) / (release / 3)) : 1);
    L[i] *= a;
    R[i] *= a;
  }
  const p = Math.max(peak(L), peak(R));
  const g = (0.5 * vel) / (p || 1);
  for (let i = 0; i < n; i++) {
    L[i] *= g;
    R[i] *= g;
  }
  return { L: fade(L, 0, 0.05), R: fade(R, 0, 0.05) };
}

/** A sub-bass note: sine with a touch of harmonic bite. */
export function subBass({ midi, dur = 0.6, vel = 0.8, bite = 0.35 }) {
  const f = mtof(midi);
  const n = samples(dur + 0.15);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const a =
      Math.min(1, t / 0.006) *
      (t > dur ? Math.exp(-(t - dur) / 0.04) : 1) *
      (0.75 + 0.25 * env(t, 0.25));
    out[i] = Math.sin(TAU * f * t) * a;
  }
  saturate(out, 1 + bite * 2.2, 1);
  normalize(out, 0.7 * vel);
  return fade(out, 0, 0.03);
}

// ---------------------------------------------------------------- textures

/** Mains hum on A (55 Hz) with its harmonics: the sound of electricity arriving. */
export function hum({ dur = 5, level = 0.4, freq = 55 }) {
  const n = samples(dur);
  const out = new Float32Array(n);
  for (let h = 1; h <= 8; h++) {
    const w = (TAU * freq * h) / SR;
    const amp = 1 / h ** 1.1;
    for (let i = 0; i < n; i++) out[i] += amp * Math.sin(w * i);
  }
  normalize(out, level);
  return out;
}

/** Surface crackle: sparse clicks of varied size, plus a bed of fine noise. */
export function crackle({
  dur = 10,
  density = 18,
  level = 0.5,
  seed = 31,
  bed = 0.06,
}) {
  const n = samples(dur);
  const out = new Float32Array(n);
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    out[i] = (r() * 2 - 1) * bed;
    if (r() < density / SR) {
      const size = r() ** 3 * level * (r() < 0.5 ? -1 : 1);
      const len = samples(0.0004 + r() * 0.0015);
      for (let k = 0; k < len && i + k < n; k++)
        out[i + k] += size * Math.exp((-k / len) * 3) * (k % 2 ? -0.6 : 1);
    }
  }
  filter(out, "highpass", 1200, 0.7);
  return out;
}

export function hiss({ dur = 10, level = 0.05, seed = 32 }) {
  const n = samples(dur);
  const out = noise(n, rng(seed));
  filter(out, "highpass", 3500, 0.7);
  for (let i = 0; i < n; i++) out[i] *= level;
  return out;
}
