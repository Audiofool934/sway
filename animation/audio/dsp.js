// DSP primitives for the soundtrack: seeded noise, biquads, a feedback-delay reverb,
// dynamics, and the effects that give each era its character (wow and flutter,
// bit-crushing, tape stop). Everything works on Float32Array buffers at SR.

import { SR } from "../src/timeline.js";

export { SR };
export const TAU = Math.PI * 2;
export const mtof = (midi) => 440 * 2 ** ((midi - 69) / 12);
export const dB = (db) => 10 ** (db / 20);
export const toDb = (x) => 20 * Math.log10(Math.max(x, 1e-9));
export const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => {
  const x = clamp(t);
  return x * x * (3 - 2 * x);
};
export const seconds = (n) => n / SR;
export const samples = (s) => Math.round(s * SR);

/** mulberry32: a small seeded generator, so every render is identical. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function noise(length, rand = rng(7)) {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = rand() * 2 - 1;
  return out;
}

/** Pink-ish noise (Paul Kellet's economy filter). */
export function pinkNoise(length, rand = rng(11)) {
  const out = new Float32Array(length);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < length; i++) {
    const white = rand() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
  return out;
}

/** RBJ cookbook biquad. */
export class Biquad {
  constructor(type, f, q = Math.SQRT1_2, gainDb = 0) {
    this.z1 = 0;
    this.z2 = 0;
    this.set(type, f, q, gainDb);
  }
  set(type, f, q = Math.SQRT1_2, gainDb = 0) {
    const w = (TAU * Math.min(f, SR * 0.49)) / SR;
    const cos = Math.cos(w);
    const sin = Math.sin(w);
    const alpha = sin / (2 * q);
    const A = 10 ** (gainDb / 40);
    let b0, b1, b2, a0, a1, a2;
    switch (type) {
      case "lowpass":
        b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0;
        a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
        break;
      case "highpass":
        b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0;
        a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
        break;
      case "bandpass": // constant 0 dB peak
        b0 = alpha; b1 = 0; b2 = -alpha;
        a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
        break;
      case "notch":
        b0 = 1; b1 = -2 * cos; b2 = 1;
        a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
        break;
      case "allpass":
        b0 = 1 - alpha; b1 = -2 * cos; b2 = 1 + alpha;
        a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
        break;
      case "peaking":
        b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A;
        a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
        break;
      case "lowshelf": {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 - (A - 1) * cos + s);
        b1 = 2 * A * (A - 1 - (A + 1) * cos);
        b2 = A * (A + 1 - (A - 1) * cos - s);
        a0 = A + 1 + (A - 1) * cos + s;
        a1 = -2 * (A - 1 + (A + 1) * cos);
        a2 = A + 1 + (A - 1) * cos - s;
        break;
      }
      case "highshelf": {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 + (A - 1) * cos + s);
        b1 = -2 * A * (A - 1 + (A + 1) * cos);
        b2 = A * (A + 1 + (A - 1) * cos - s);
        a0 = A + 1 - (A - 1) * cos + s;
        a1 = 2 * (A - 1 - (A + 1) * cos);
        a2 = A + 1 - (A - 1) * cos - s;
        break;
      }
      default:
        throw new Error(`unknown filter ${type}`);
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  tick(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
  process(buffer) {
    for (let i = 0; i < buffer.length; i++) buffer[i] = this.tick(buffer[i]);
    return buffer;
  }
}

/** Filter `buffer` in place; `f` may be a number or a function of the sample index. */
export function filter(buffer, type, f, q = Math.SQRT1_2, gainDb = 0) {
  if (typeof f === "number") return new Biquad(type, f, q, gainDb).process(buffer);
  const bq = new Biquad(type, f(0), q, gainDb);
  const STEP = 32;
  for (let i = 0; i < buffer.length; i++) {
    if (i % STEP === 0) bq.set(type, f(i), q, gainDb);
    buffer[i] = bq.tick(buffer[i]);
  }
  return buffer;
}

/** Steeper filters by cascading identical biquads. */
export function filterN(buffer, type, f, q, order = 2) {
  for (let i = 0; i < order; i++) filter(buffer, type, f, q);
  return buffer;
}

/** A moog-style 4-pole ladder low-pass (zero-delay feedback), with time-varying cutoff. */
export function ladder(buffer, cutoff, resonance = 0.3, drive = 1) {
  const k = clamp(resonance, 0, 1) * 3.9;
  let s1 = 0, s2 = 0, s3 = 0, s4 = 0;
  const STEP = 8;
  let G = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (i % STEP === 0) {
      const fc = clamp(typeof cutoff === "number" ? cutoff : cutoff(i), 20, SR * 0.45);
      const g = Math.tan((Math.PI * fc) / SR);
      G = g / (1 + g);
    }
    const G2 = G * G;
    const G4 = G2 * G2;
    const S = (1 - G) * (G2 * G * s1 + G2 * s2 + G * s3 + s4);
    let u = (Math.tanh(buffer[i] * drive) - k * S) / (1 + k * G4);
    let v = (u - s1) * G;
    const y1 = v + s1; s1 = y1 + v;
    v = (y1 - s2) * G;
    const y2 = v + s2; s2 = y2 + v;
    v = (y2 - s3) * G;
    const y3 = v + s3; s3 = y3 + v;
    v = (y3 - s4) * G;
    const y4 = v + s4; s4 = y4 + v;
    buffer[i] = y4;
  }
  return buffer;
}

/** Band-limited sawtooth / pulse generation (PolyBLEP). Returns one sample per call. */
function polyBlep(t, dt) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}
export class Osc {
  constructor(phase = 0) {
    this.phase = phase;
  }
  saw(freq) {
    const dt = freq / SR;
    this.phase += dt;
    if (this.phase >= 1) this.phase -= 1;
    return 2 * this.phase - 1 - polyBlep(this.phase, dt);
  }
  pulse(freq, width = 0.5) {
    const dt = freq / SR;
    this.phase += dt;
    if (this.phase >= 1) this.phase -= 1;
    let y = this.phase < width ? 1 : -1;
    y += polyBlep(this.phase, dt);
    y -= polyBlep((this.phase + 1 - width) % 1, dt);
    return y;
  }
  sine(freq) {
    this.phase += freq / SR;
    if (this.phase >= 1) this.phase -= 1;
    return Math.sin(TAU * this.phase);
  }
  tri(freq) {
    this.phase += freq / SR;
    if (this.phase >= 1) this.phase -= 1;
    return 4 * Math.abs(this.phase - 0.5) - 1;
  }
}

/** A fractional delay line with linear interpolation. */
export class Delay {
  constructor(maxSamples) {
    this.size = Math.max(4, Math.ceil(maxSamples) + 4);
    this.buffer = new Float32Array(this.size);
    this.write = 0;
  }
  read(delay) {
    let pos = this.write - delay;
    while (pos < 0) pos += this.size;
    const i = Math.floor(pos);
    const frac = pos - i;
    const a = this.buffer[i % this.size];
    const b = this.buffer[(i + 1) % this.size];
    return a + (b - a) * frac;
  }
  push(x) {
    this.buffer[this.write] = x;
    this.write = (this.write + 1) % this.size;
  }
}

/**
 * A stereo feedback-delay-network reverb (8 lines, Householder feedback, damped, with
 * slowly modulated lines). Returns the wet signal only.
 */
export function reverb(inL, inR, opts = {}) {
  const { rt60 = 2.5, predelay = 0.015, damping = 0.35, size = 1, modulation = 0.0008, lowCut = 150, highCut = 9000 } = opts;
  const n = inL.length;
  const lengthsMs = [29.7, 37.1, 41.1, 43.7, 53.0, 59.3, 67.7, 79.1];
  const lines = lengthsMs.map((ms) => Math.round((ms * size * SR) / 1000));
  const delays = lines.map((length) => new Delay(length + 64));
  const gains = lines.map((length) => 10 ** ((-3 * length) / (rt60 * SR)));
  const lp = new Float32Array(8);
  const lfoRate = [0.11, 0.13, 0.17, 0.19, 0.23, 0.29, 0.31, 0.37];
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  const pre = new Delay(samples(predelay) + 8);
  // Input diffusion: four short allpasses in series.
  const apLengths = [142, 107, 379, 277].map((x) => Math.round((x * SR) / 48000));
  const ap = apLengths.map((length) => ({ d: new Delay(length + 2), length }));
  const preFilters = [new Biquad("highpass", lowCut), new Biquad("lowpass", highCut)];
  const signs = [1, -1, 1, -1, 1, -1, 1, -1];
  const tapL = [1, 0, 1, 0, 1, 0, 1, 0];
  const tapR = [0, 1, 0, 1, 0, 1, 0, 1];
  const x = new Float64Array(8);
  for (let i = 0; i < n; i++) {
    pre.push(0.5 * (inL[i] + inR[i]));
    let s = pre.read(samples(predelay));
    s = preFilters[1].tick(preFilters[0].tick(s));
    for (const stage of ap) {
      const delayed = stage.d.read(stage.length);
      const v = s - 0.6 * delayed;
      stage.d.push(v);
      s = delayed + 0.6 * v;
    }
    let sum = 0;
    for (let k = 0; k < 8; k++) {
      const mod = 1 + modulation * Math.sin((TAU * lfoRate[k] * i) / SR + k);
      x[k] = delays[k].read(lines[k] * mod);
      sum += x[k];
    }
    const mean = sum * 0.25; // Householder: x - (2/N) * sum, N = 8
    let l = 0, r = 0;
    for (let k = 0; k < 8; k++) {
      let y = (x[k] - mean) * gains[k];
      lp[k] = y * (1 - damping) + lp[k] * damping;
      y = lp[k];
      delays[k].push(y + s * 0.35 * signs[k]);
      l += x[k] * tapL[k];
      r += x[k] * tapR[k];
    }
    outL[i] = l * 0.5;
    outR[i] = r * 0.5;
  }
  return { L: outL, R: outR };
}

/** Feed-forward stereo-linked compressor. Operates in place. `key` is an optional sidechain. */
export function compress(L, R, { threshold = -18, ratio = 3, attack = 0.01, release = 0.15, knee = 6, makeup = 0, key = null } = {}) {
  const n = L.length;
  const attackCoef = Math.exp(-1 / (attack * SR));
  const releaseCoef = Math.exp(-1 / (release * SR));
  let reduction = 0;
  const gainMakeup = dB(makeup);
  for (let i = 0; i < n; i++) {
    const level = key ? Math.abs(key[i]) : Math.max(Math.abs(L[i]), Math.abs(R[i]));
    const over = toDb(level) - threshold;
    let target = 0;
    if (2 * over > knee) target = (over * (1 - 1 / ratio));
    else if (2 * Math.abs(over) <= knee) target = ((1 - 1 / ratio) * (over + knee / 2) ** 2) / (2 * knee);
    reduction = target > reduction ? attackCoef * reduction + (1 - attackCoef) * target : releaseCoef * reduction + (1 - releaseCoef) * target;
    const g = dB(-reduction) * gainMakeup;
    L[i] *= g;
    R[i] *= g;
  }
}

/**
 * A lookahead brick-wall limiter. The gain for each sample is the smallest gain needed
 * by any sample in the next `lookahead` seconds, smoothed so it ramps in before a peak
 * and recovers with `release`. Operates in place.
 */
export function limit(L, R, { ceiling = -1, lookahead = 0.003, release = 0.08 } = {}) {
  const n = L.length;
  const cap = dB(ceiling);
  const la = Math.max(2, Math.round(lookahead * SR));
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const peak = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    need[i] = peak > cap ? cap / peak : 1;
  }
  // w[j] = min(need[j-la+1 .. j]); the look-ahead minimum at k is w[k+la-1].
  const w = new Float32Array(n);
  const deque = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let j = 0; j < n; j++) {
    while (tail > head && need[deque[tail - 1]] >= need[j]) tail--;
    deque[tail++] = j;
    while (deque[head] <= j - la) head++;
    w[j] = need[deque[head]];
  }
  // Start as if the signal before the first sample needed no reduction.
  const ring = new Float32Array(la).fill(1);
  let sum = la;
  let g = 1;
  const releaseCoef = Math.exp(-1 / (release * SR));
  for (let i = 0; i < n; i++) {
    const m = w[Math.min(n - 1, i + la - 1)];
    sum += m - ring[i % la];
    ring[i % la] = m;
    const smooth = sum / la;
    g = smooth < g ? smooth : g + (smooth - g) * (1 - releaseCoef);
    L[i] *= g;
    R[i] *= g;
  }
}

/** Soft saturation (tanh), in place. */
export function saturate(buffer, drive = 1.5, mix = 1) {
  const norm = 1 / Math.tanh(drive);
  for (let i = 0; i < buffer.length; i++) {
    const x = buffer[i];
    buffer[i] = x * (1 - mix) + Math.tanh(x * drive) * norm * mix;
  }
  return buffer;
}

/** Wow and flutter: read the buffer through a slowly wobbling delay. Returns a new buffer. */
export function wobble(buffer, { wow = 0.004, wowRate = 0.8, flutter = 0.0012, flutterRate = 7.3, seed = 3 } = {}) {
  const n = buffer.length;
  const out = new Float32Array(n);
  const phase = rng(seed)() * TAU;
  // Relative pitch deviation d  =>  delay amplitude A = d * SR / (2*pi*rate).
  const wowAmp = (wow * SR) / (TAU * wowRate);
  const flutterAmp = (flutter * SR) / (TAU * flutterRate);
  for (let i = 0; i < n; i++) {
    const shift =
      wowAmp * Math.sin((TAU * wowRate * i) / SR + phase) +
      flutterAmp * Math.sin((TAU * flutterRate * i) / SR + phase * 2.3);
    const pos = i - shift - wowAmp - flutterAmp;
    const j = Math.floor(pos);
    const frac = pos - j;
    const a = j >= 0 && j < n ? buffer[j] : 0;
    const b = j + 1 >= 0 && j + 1 < n ? buffer[j + 1] : 0;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** Sample-rate and bit-depth reduction. `rate` and `bits` may be numbers or functions of time (s). */
export function crush(buffer, { rate = SR, bits = 16, mix = 1 } = {}) {
  const out = new Float32Array(buffer.length);
  let held = 0;
  let counter = 0;
  for (let i = 0; i < buffer.length; i++) {
    const t = i / SR;
    const r = typeof rate === "function" ? rate(t) : rate;
    const b = typeof bits === "function" ? bits(t) : bits;
    counter += r / SR;
    if (counter >= 1 || i === 0) {
      counter -= Math.floor(counter);
      const levels = 2 ** (Math.max(1, b) - 1);
      held = Math.round(buffer[i] * levels) / levels;
    }
    out[i] = buffer[i] * (1 - mix) + held * mix;
  }
  return out;
}

/** Resample by a time-varying rate (tape stop / speed change); `rate(t)` in [0, 2]. */
export function varispeed(buffer, rate, length = buffer.length) {
  const out = new Float32Array(length);
  let pos = 0;
  for (let i = 0; i < length; i++) {
    const j = Math.floor(pos);
    if (j + 1 >= buffer.length) break;
    const frac = pos - j;
    out[i] = buffer[j] + (buffer[j + 1] - buffer[j]) * frac;
    pos += rate(i / SR);
  }
  return out;
}

export const reversed = (buffer) => Float32Array.from(buffer).reverse();

/** Fade the edges of a buffer in place (raised-cosine). */
export function fade(buffer, inSeconds = 0.005, outSeconds = 0.02) {
  const a = Math.min(buffer.length, samples(inSeconds));
  const b = Math.min(buffer.length, samples(outSeconds));
  for (let i = 0; i < a; i++) buffer[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / a);
  for (let i = 0; i < b; i++) buffer[buffer.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / b);
  return buffer;
}

export function peak(buffer) {
  let p = 0;
  for (let i = 0; i < buffer.length; i++) p = Math.max(p, Math.abs(buffer[i]));
  return p;
}

export function rms(buffer, from = 0, to = buffer.length) {
  let sum = 0;
  for (let i = from; i < to; i++) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / Math.max(1, to - from));
}

/** Scale a buffer so its peak is `target` (a mono note's nominal level). */
export function normalize(buffer, target = 0.5) {
  const p = peak(buffer);
  if (p > 0) {
    const g = target / p;
    for (let i = 0; i < buffer.length; i++) buffer[i] *= g;
  }
  return buffer;
}

// ITU-R BS.1770 K-weighting (coefficients for 48 kHz) and gated loudness, used to balance
// chapters against each other.
function kWeighted(buffer) {
  const out = new Float32Array(buffer.length);
  const [b0, b1, b2] = [1.53512485958697, -2.69169618940638, 1.19839281085285];
  const [a1, a2] = [-1.69065929318241, 0.73248077421585];
  const [c1, c2] = [-1.99004745483398, 0.99007225036621];
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, u1 = 0, u2 = 0, v1 = 0, v2 = 0;
  for (let i = 0; i < buffer.length; i++) {
    const x = buffer[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    const v = y - 2 * u1 + u2 - c1 * v1 - c2 * v2;
    u2 = u1; u1 = y; v2 = v1; v1 = v;
    out[i] = v;
  }
  return out;
}

/** Integrated loudness (LUFS, BS.1770 gating) of a stereo range, in seconds. */
export function loudness(L, R, from = 0, to = L.length / SR) {
  const a = Math.max(0, Math.round(from * SR));
  const b = Math.min(L.length, Math.round(to * SR));
  const kl = kWeighted(L.subarray(a, b));
  const kr = kWeighted(R.subarray(a, b));
  const hop = Math.round(0.1 * SR);
  const hops = Math.floor((b - a) / hop);
  const energy = new Float64Array(hops);
  for (let h = 0; h < hops; h++) {
    let e = 0;
    for (let i = h * hop; i < (h + 1) * hop; i++) e += kl[i] * kl[i] + kr[i] * kr[i];
    energy[h] = e / hop;
  }
  const blocks = [];
  for (let h = 0; h + 4 <= hops; h++) blocks.push((energy[h] + energy[h + 1] + energy[h + 2] + energy[h + 3]) / 4);
  const lufs = (e) => -0.691 + 10 * Math.log10(e + 1e-12);
  const absolute = blocks.filter((e) => lufs(e) > -70);
  if (!absolute.length) return -70;
  const mean = absolute.reduce((x, y) => x + y, 0) / absolute.length;
  const relative = absolute.filter((e) => lufs(e) > lufs(mean) - 10);
  return lufs(relative.reduce((x, y) => x + y, 0) / relative.length);
}
