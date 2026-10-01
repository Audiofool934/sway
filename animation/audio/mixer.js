// Stereo buses and a small mixer: every sound is a mono or stereo buffer placed at a film
// time, with a gain, a pan, and sends to shared reverbs and echoes. Stems are separate
// buses so one section can be processed (an old-recording filter, a filter sweep)
// before it joins the master.

import { Delay, SR, TAU, dB, reverb, samples } from "./dsp.js";

export class Bus {
  constructor(length) {
    this.length = length;
    this.L = new Float32Array(length);
    this.R = new Float32Array(length);
  }

  /** Add a mono buffer at film time `t` (seconds). Equal-power pan in [-1, 1]. */
  add(mono, t, { gain = 1, pan = 0 } = {}) {
    const start = Math.round(t * SR);
    const angle = ((pan + 1) * Math.PI) / 4;
    const gl = Math.cos(angle) * gain;
    const gr = Math.sin(angle) * gain;
    const from = Math.max(0, -start);
    const to = Math.min(mono.length, this.length - start);
    for (let i = from; i < to; i++) {
      const v = mono[i];
      this.L[start + i] += v * gl;
      this.R[start + i] += v * gr;
    }
  }

  /** Add a stereo pair at film time `t`. */
  addStereo(left, right, t, { gain = 1 } = {}) {
    const start = Math.round(t * SR);
    const from = Math.max(0, -start);
    const to = Math.min(left.length, this.length - start);
    for (let i = from; i < to; i++) {
      this.L[start + i] += left[i] * gain;
      this.R[start + i] += right[i] * gain;
    }
  }

  /** Add another bus (same length) scaled by `gain`. */
  addBus(other, gain = 1) {
    for (let i = 0; i < this.length; i++) {
      this.L[i] += other.L[i] * gain;
      this.R[i] += other.R[i] * gain;
    }
  }

  /** Multiply by a gain envelope that is a function of time in seconds. */
  gainCurve(fn, from = 0, to = this.length / SR) {
    const a = Math.max(0, Math.round(from * SR));
    const b = Math.min(this.length, Math.round(to * SR));
    for (let i = a; i < b; i++) {
      const g = fn(i / SR);
      this.L[i] *= g;
      this.R[i] *= g;
    }
  }

  /** Run `fn(L, R)` on a copy of a time range and write the result back. */
  region(from, to, fn) {
    const a = Math.max(0, Math.round(from * SR));
    const b = Math.min(this.length, Math.round(to * SR));
    if (b <= a) return;
    const L = this.L.slice(a, b);
    const R = this.R.slice(a, b);
    const out = fn(L, R) ?? { L, R };
    this.L.set(out.L, a);
    this.R.set(out.R, a);
  }
}

/** Duck a bus on each trigger time: gain dips to (1 - depth) and recovers over `release`. */
export function duck(
  bus,
  times,
  { depth = 0.5, attack = 0.004, release = 0.18 } = {},
) {
  const n = bus.length;
  const curve = new Float32Array(n).fill(1);
  const att = Math.max(1, samples(attack));
  const rel = samples(release);
  for (const t of times) {
    const start = Math.round(t * SR);
    for (let i = 0; i < att + rel * 4; i++) {
      const at = start + i;
      if (at < 0 || at >= n) continue;
      const amount = i < att ? i / att : Math.exp(-(i - att) / rel);
      const g = 1 - depth * amount;
      if (g < curve[at]) curve[at] = g;
    }
  }
  for (let i = 0; i < n; i++) {
    bus.L[i] *= curve[i];
    bus.R[i] *= curve[i];
  }
}

/** Feedback echo (tape-style: each repeat is darker). Returns wet-only stereo. */
export function echo(
  inL,
  inR,
  { time = 0.45, feedback = 0.4, tone = 2600, pingPong = true } = {},
) {
  const n = inL.length;
  const d = samples(time);
  const dl = new Delay(d + 4);
  const dr = new Delay(d + 4);
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  const a = Math.exp((-TAU * tone) / SR);
  let lpL = 0;
  let lpR = 0;
  for (let i = 0; i < n; i++) {
    const wl = dl.read(d);
    const wr = dr.read(d);
    lpL = wl * (1 - a) + lpL * a;
    lpR = wr * (1 - a) + lpR * a;
    dl.push(inL[i] + (pingPong ? lpR : lpL) * feedback);
    dr.push(inR[i] + (pingPong ? lpL : lpR) * feedback);
    outL[i] = wl;
    outR[i] = wr;
  }
  return { L: outL, R: outR };
}

/**
 * The film's mixer: a dry master plus send buses. `put` places a voice; `finish` runs the
 * sends through their effects and returns the summed stereo master.
 */
export class Mixer {
  constructor(durationSeconds) {
    this.length = Math.ceil(durationSeconds * SR);
    this.master = new Bus(this.length);
    this.sends = {
      room: new Bus(this.length), // small, bright space
      hall: new Bus(this.length), // large, dark space
      echo: new Bus(this.length), // tape echo
    };
    this.stems = {};
    this.deferred = [];
  }

  /** Register stem processing to run once every era has been composed. */
  after(label, fn) {
    this.deferred.push({ label, fn });
  }

  runDeferred() {
    for (const { fn } of this.deferred) fn();
    this.deferred = [];
  }

  /** A named stem: a bus that is processed and then added to the master by `finish`. */
  stem(name) {
    return (this.stems[name] ??= { bus: new Bus(this.length), gain: 1 });
  }

  /**
   * Place a mono buffer (or `{L, R}` pair) at film time `t`.
   * `room`, `hall`, and `echo` are send levels; `stem` routes the dry signal to a stem.
   */
  put(
    voice,
    t,
    {
      gain = 1,
      pan = 0,
      room = 0,
      hall = 0,
      echo: echoSend = 0,
      stem = null,
    } = {},
  ) {
    const dry = stem ? this.stem(stem).bus : this.master;
    const stereo = !(voice instanceof Float32Array);
    // A single NaN would circulate in the reverbs forever, so refuse it where it starts.
    for (const channel of stereo ? [voice.L, voice.R] : [voice])
      for (let i = 0; i < channel.length; i++)
        if (!Number.isFinite(channel[i]))
          throw new Error(
            `non-finite sample ${i} in a voice placed at ${t.toFixed(2)} s`,
          );
    const add = (bus, g) =>
      stereo
        ? bus.addStereo(voice.L, voice.R, t, { gain: g })
        : bus.add(voice, t, { gain: g, pan });
    add(dry, gain);
    if (room) add(this.sends.room, gain * room);
    if (hall) add(this.sends.hall, gain * hall);
    if (echoSend) add(this.sends.echo, gain * echoSend);
  }

  finish({ room = {}, hall = {}, echo: echoOpts = {}, returns = {} } = {}) {
    const out = new Bus(this.length);
    out.addBus(this.master);
    for (const { bus, gain } of Object.values(this.stems))
      out.addBus(bus, gain);
    const r = { room: 0.7, hall: 0.7, echo: 0.6, ...returns };
    const wetRoom = reverb(this.sends.room.L, this.sends.room.R, {
      rt60: 0.9,
      damping: 0.3,
      size: 0.6,
      ...room,
    });
    out.L.set(out.L.map((v, i) => v + wetRoom.L[i] * r.room));
    out.R.set(out.R.map((v, i) => v + wetRoom.R[i] * r.room));
    const wetHall = reverb(this.sends.hall.L, this.sends.hall.R, {
      rt60: 3.6,
      damping: 0.45,
      size: 1.4,
      predelay: 0.03,
      ...hall,
    });
    out.L.set(out.L.map((v, i) => v + wetHall.L[i] * r.hall));
    out.R.set(out.R.map((v, i) => v + wetHall.R[i] * r.hall));
    const wetEcho = echo(this.sends.echo.L, this.sends.echo.R, echoOpts);
    out.L.set(out.L.map((v, i) => v + wetEcho.L[i] * r.echo));
    out.R.set(out.R.map((v, i) => v + wetEcho.R[i] * r.echo));
    return out;
  }
}

export { dB };
