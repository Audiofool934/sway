// Web Audio instruments and mix. Every sound is scheduled at an exact AudioContext
// time; sustained voices return a handle so the band can be cut mid-note.

import { frequency } from "./theory.js";

const SILENT = 0.0001;

function noiseBuffer(ctx, seconds = 2) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// A dark, smooth stereo tail: decaying noise, low-passed a little more as it fades.
function impulse(ctx, seconds = 2.6, decay = 2.8) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let smooth = 0;
    for (let i = 0; i < length; i++) {
      const fade = (1 - i / length) ** decay;
      const damping = 0.35 + 0.6 * (i / length);
      smooth += (1 - damping) * (Math.random() * 2 - 1 - smooth);
      data[i] = smooth * fade;
    }
  }
  return buffer;
}

// Linear below -1.4 dB, then a smooth knee that never exceeds full scale.
// A WaveShaper's curve always spans inputs from -1 to 1; louder input holds the end value.
function safetyClipper(ctx) {
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(4097);
  const knee = 0.85;
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    const magnitude = Math.abs(x);
    const shaped =
      magnitude <= knee
        ? magnitude
        : knee + (0.99 - knee) * Math.tanh((magnitude - knee) / (0.99 - knee));
    curve[i] = Math.sign(x) * shaped;
  }
  shaper.curve = curve;
  shaper.oversample = "4x";
  return shaper;
}

function saturation(ctx, drive = 2) {
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x) / Math.tanh(drive);
  }
  shaper.curve = curve;
  shaper.oversample = "2x";
  return shaper;
}

// Attack to `peak`, fall toward `sustain`, and release from `end` when it is known.
function envelope(
  param,
  t,
  { attack, peak, decay = 0, sustain = peak, release, end },
) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  if (decay) param.setTargetAtTime(sustain, t + attack, decay / 3);
  if (end !== undefined)
    param.setTargetAtTime(0, Math.max(end, t + attack), release / 3);
}

export class Synth {
  constructor(ctx, { beatSeconds = 0.6 } = {}) {
    this.ctx = ctx;
    this.noise = noiseBuffer(ctx);

    this.master = ctx.createGain();
    this.master.gain.value = 0.75;
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -16;
    this.compressor.knee.value = 8;
    this.compressor.ratio.value = 3;
    this.compressor.attack.value = 0.012;
    this.compressor.release.value = 0.2;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.08;
    this.clipper = safetyClipper(ctx);
    this.master
      .connect(this.compressor)
      .connect(this.limiter)
      .connect(this.clipper);
    this.clipper.connect(ctx.destination);
    this.output = this.clipper;

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = impulse(ctx);
    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 0.32;
    this.reverb.connect(reverbReturn).connect(this.master);

    this.delay = ctx.createDelay(2);
    const feedback = ctx.createGain();
    feedback.gain.value = 0.34;
    const damping = ctx.createBiquadFilter();
    damping.type = "lowpass";
    damping.frequency.value = 2600;
    this.delay.connect(damping).connect(feedback).connect(this.delay);
    const delayReturn = ctx.createGain();
    delayReturn.gain.value = 0.28;
    this.delay.connect(delayReturn).connect(this.master);
    this.setTempo(beatSeconds);

    // Harmony and bass duck under the kick so the groove breathes.
    this.duck = ctx.createGain();
    this.duck.connect(this.master);
    this.buses = {};
    this.levels = {}; // Each bus's own gain, which the listening test mutes and restores.
    const bus = (
      name,
      gain,
      { pan = 0, reverb = 0, delay = 0, ducked = false } = {},
    ) => {
      const node = ctx.createGain();
      node.gain.value = gain;
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      node.connect(panner).connect(ducked ? this.duck : this.master);
      if (reverb) this.#send(node, this.reverb, reverb);
      if (delay) this.#send(node, this.delay, delay);
      this.buses[name] = node;
      this.levels[name] = gain;
    };
    bus("kick", 0.36);
    bus("snare", 1.2, { reverb: 0.18 });
    bus("clap", 2.5, { reverb: 0.25, pan: 0.05 });
    bus("hat", 0.38, { pan: 0.18 });
    bus("openhat", 0.5, { pan: 0.22 });
    bus("shaker", 0.54, { pan: -0.25 });
    bus("crash", 0.2, { reverb: 0.2 });
    bus("riser", 0.25, { reverb: 0.3 });
    bus("bass", 0.16, { ducked: true });
    bus("pad", 1.3, { reverb: 0.45, ducked: true });
    // Generated harmony stands in for the pad; its audio already carries a room.
    bus("harmony", 1, { reverb: 0.15, ducked: true });
    bus("keys", 0.75, { reverb: 0.25, pan: -0.12, ducked: true });
    // The composer's answering line in the keys' sound, on a bus of its own.
    bus("answer", 0.75, { reverb: 0.25, pan: -0.12, ducked: true });
    bus("arp", 0.16, { delay: 0.4, reverb: 0.2, pan: 0.25, ducked: true });
    bus("lead", 0.65, { delay: 0.28, reverb: 0.22 });
    bus("loop", 0.36, { delay: 0.18, reverb: 0.3 });
    this.bassDrive = saturation(ctx, 2.2);
    this.bassDrive.connect(this.buses.bass);
    this.kickDrive = saturation(ctx, 1.6);
    this.kickDrive.connect(this.buses.kick);
    this.openHat = null;
    // TEMPORARY listening test: on bars MRT2 plays, the pad and answering line still play
    // into these, silent until MRT2 is muted, so the two can be compared on the same bar.
    this.shadows = {};
    for (const name of ["pad", "answer"]) {
      const node = ctx.createGain();
      node.gain.value = 0;
      node.connect(this.buses[name]);
      this.shadows[name] = node;
    }
    this.ducking = true; // Off while the drums are muted, so nothing pumps without a kick.
  }

  /** Insert a node, such as the recorder, between the finished mix and the speakers. */
  route(node) {
    this.clipper.disconnect();
    this.clipper.connect(node);
    node.connect(this.ctx.destination);
  }

  #send(from, to, amount) {
    const gain = this.ctx.createGain();
    gain.gain.value = amount;
    from.connect(gain).connect(to);
  }

  setTempo(beatSeconds) {
    this.delay.delayTime.value = 0.75 * beatSeconds; // Dotted eighth.
  }

  #noise(t, duration) {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true; // Long sounds such as crashes outlast the buffer.
    source.start(t, Math.random() * (this.noise.duration - 0.1));
    source.stop(t + duration);
    return source;
  }

  #filter(type, frequency, q = 0.7) {
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    return filter;
  }

  #gain(value = 0) {
    const gain = this.ctx.createGain();
    gain.gain.value = value;
    return gain;
  }

  /** Play one band event. Returns a handle for sustained sounds. */
  play(event, t, beatSeconds) {
    const seconds = event.beats * beatSeconds;
    switch (event.part) {
      case "kick":
        return this.kick(t, event.velocity);
      case "snare":
        return this.snare(t, event.velocity);
      case "clap":
        return this.clap(t, event.velocity);
      case "hat":
        return this.hat(t, event.velocity, false);
      case "openhat":
        return this.hat(t, event.velocity, true);
      case "shaker":
        return this.shaker(t, event.velocity);
      case "crash":
        return this.crash(t, event.velocity, seconds);
      case "riser":
        return this.riser(t, event.velocity, seconds);
      case "bass":
        return this.bass(t, event.velocity, event.pitch, seconds);
      case "pad":
        return this.pad(
          t,
          event.velocity,
          event.pitches,
          seconds,
          event.brightness,
          event.shadow ? this.shadows.pad : this.buses.pad,
        );
      case "keys":
        return this.keys(t, event.velocity, event.pitches, seconds);
      // The composer's answering line, when generated harmony is not playing it.
      case "answer":
        return this.keys(
          t,
          event.velocity,
          [event.pitch],
          seconds,
          event.shadow ? this.shadows.answer : this.buses.answer,
        );
      case "arp":
        return this.arp(t, event.velocity, event.pitch, seconds);
    }
  }

  kick(t, velocity) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(165, t);
    osc.frequency.exponentialRampToValueAtTime(52, t + 0.08);
    osc.frequency.exponentialRampToValueAtTime(44, t + 0.4);
    const amp = this.#gain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(velocity, t + 0.002);
    amp.gain.setTargetAtTime(0, t + 0.03, 0.09);
    osc.connect(amp).connect(this.kickDrive);
    osc.start(t);
    osc.stop(t + 0.7);
    const click = this.#noise(t, 0.02);
    const clickAmp = this.#gain();
    clickAmp.gain.setValueAtTime(velocity * 0.25, t);
    clickAmp.gain.setTargetAtTime(0, t, 0.004);
    click
      .connect(this.#filter("highpass", 1800))
      .connect(clickAmp)
      .connect(this.buses.kick);
    // Duck the harmony bus with the kick.
    if (!this.ducking) return;
    const duck = this.duck.gain;
    duck.cancelScheduledValues(t);
    duck.setTargetAtTime(1 - 0.35 * velocity, t, 0.005);
    duck.setTargetAtTime(1, t + 0.06, 0.09);
  }

  snare(t, velocity) {
    const noise = this.#noise(t, 0.3);
    const amp = this.#gain();
    amp.gain.setValueAtTime(velocity, t);
    amp.gain.setTargetAtTime(0, t + 0.004, 0.08);
    noise
      .connect(this.#filter("bandpass", 1900, 0.6))
      .connect(this.#filter("highpass", 700))
      .connect(amp)
      .connect(this.buses.snare);
    const tone = this.ctx.createOscillator();
    tone.type = "triangle";
    tone.frequency.setValueAtTime(200, t);
    tone.frequency.exponentialRampToValueAtTime(165, t + 0.08);
    const toneAmp = this.#gain();
    toneAmp.gain.setValueAtTime(velocity * 0.7, t);
    toneAmp.gain.setTargetAtTime(0, t + 0.002, 0.03);
    tone.connect(toneAmp).connect(this.buses.snare);
    tone.start(t);
    tone.stop(t + 0.25);
  }

  clap(t, velocity) {
    const noise = this.#noise(t, 0.4);
    const amp = this.#gain();
    const g = amp.gain;
    g.setValueAtTime(0, t);
    for (const offset of [0, 0.011, 0.023]) {
      g.setValueAtTime(velocity, t + offset);
      g.setTargetAtTime(velocity * 0.2, t + offset + 0.001, 0.004);
    }
    g.setValueAtTime(velocity * 0.8, t + 0.034);
    g.setTargetAtTime(0, t + 0.035, 0.07);
    noise
      .connect(this.#filter("bandpass", 1150, 1.1))
      .connect(amp)
      .connect(this.buses.clap);
  }

  hat(t, velocity, open) {
    const length = open ? 0.5 : 0.08;
    const noise = this.#noise(t, length);
    const amp = this.#gain();
    amp.gain.setValueAtTime(velocity, t);
    amp.gain.setTargetAtTime(0, t + 0.001, open ? 0.11 : 0.016);
    noise
      .connect(this.#filter("highpass", 7200))
      .connect(this.#filter("peaking", 10500, 1))
      .connect(this.#filter("lowpass", 13000))
      .connect(amp)
      .connect(this.buses[open ? "openhat" : "hat"]);
    if (open) this.openHat = amp;
    else if (this.openHat) {
      // A closed hat chokes a ringing open hat, as on a real kit.
      this.openHat.gain.cancelAndHoldAtTime(t);
      this.openHat.gain.setTargetAtTime(0, t, 0.008);
      this.openHat = null;
    }
  }

  shaker(t, velocity) {
    const noise = this.#noise(t, 0.12);
    const amp = this.#gain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(velocity, t + 0.012);
    amp.gain.setTargetAtTime(0, t + 0.014, 0.02);
    noise
      .connect(this.#filter("bandpass", 6200, 1.2))
      .connect(amp)
      .connect(this.buses.shaker);
  }

  crash(t, velocity, seconds) {
    const length = Math.max(1.8, seconds);
    const noise = this.#noise(t, length);
    const amp = this.#gain();
    amp.gain.setValueAtTime(velocity, t);
    amp.gain.setTargetAtTime(0, t + 0.01, length / 4);
    noise
      .connect(this.#filter("highpass", 4200))
      .connect(this.#filter("peaking", 7500, 0.8))
      .connect(this.#filter("lowpass", 12000))
      .connect(amp)
      .connect(this.buses.crash);
    return this.#handle([amp.gain], [noise], 0.05);
  }

  riser(t, velocity, seconds) {
    const noise = this.#noise(t, seconds + 0.05);
    const filter = this.#filter("bandpass", 300, 2.2);
    filter.frequency.setValueAtTime(300, t);
    filter.frequency.exponentialRampToValueAtTime(7000, t + seconds);
    const amp = this.#gain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(velocity, t + seconds);
    amp.gain.setTargetAtTime(0, t + seconds, 0.01);
    noise.connect(filter).connect(amp).connect(this.buses.riser);
    return this.#handle([amp.gain], [noise], 0.03);
  }

  bass(t, velocity, pitch, seconds) {
    const ctx = this.ctx;
    const f = frequency(pitch);
    const sub = ctx.createOscillator();
    sub.frequency.value = f;
    const body = ctx.createOscillator();
    body.type = "sawtooth";
    body.frequency.value = f;
    const tone = this.#filter("lowpass", 220 + 520 * velocity, 1.2);
    tone.frequency.setValueAtTime(260 + 900 * velocity, t);
    tone.frequency.setTargetAtTime(220 + 300 * velocity, t + 0.01, 0.12);
    // More body than sub, so the bass line still reads on laptop speakers.
    const subLevel = this.#gain(0.45);
    const bodyLevel = this.#gain(0.35);
    const amp = this.#gain();
    const end = t + seconds;
    envelope(amp.gain, t, {
      attack: 0.004,
      peak: velocity,
      decay: 0.4,
      sustain: velocity * 0.8,
      release: 0.07,
      end,
    });
    sub.connect(subLevel).connect(amp);
    body.connect(tone).connect(bodyLevel).connect(amp);
    amp.connect(this.bassDrive);
    for (const osc of [sub, body]) {
      osc.start(t);
      osc.stop(end + 0.2);
    }
    return this.#handle([amp.gain], [sub, body], 0.02);
  }

  pad(
    t,
    velocity,
    pitches,
    seconds,
    brightness = 0.4,
    destination = this.buses.pad,
  ) {
    const ctx = this.ctx;
    const filter = this.#filter("lowpass", 350 + 2600 * brightness, 0.5);
    const amp = this.#gain();
    const end = t + seconds;
    envelope(amp.gain, t, { attack: 0.45, peak: velocity, release: 0.9, end });
    filter.connect(amp).connect(destination);
    const oscillators = [];
    for (const pitch of pitches)
      for (const detune of [-9, 7]) {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = frequency(pitch);
        osc.detune.value = detune;
        const level = this.#gain(0.06);
        osc.connect(level).connect(filter);
        osc.start(t);
        osc.stop(end + 3);
        oscillators.push(osc);
      }
    return this.#handle([amp.gain], oscillators, 0.15);
  }

  // Two-operator FM electric piano: a bright attack that mellows as it rings.
  keys(t, velocity, pitches, seconds, destination = this.buses.keys) {
    const ctx = this.ctx;
    const amp = this.#gain();
    const end = t + seconds;
    envelope(amp.gain, t, {
      attack: 0.003,
      peak: velocity,
      decay: 1.4,
      sustain: velocity * 0.35,
      release: 0.35,
      end,
    });
    amp.connect(destination);
    const oscillators = [];
    for (const pitch of pitches) {
      const f = frequency(pitch);
      const carrier = ctx.createOscillator();
      carrier.frequency.value = f;
      const modulator = ctx.createOscillator();
      modulator.frequency.value = f;
      const index = this.#gain();
      index.gain.setValueAtTime(f * (1.1 + 1.2 * velocity), t);
      index.gain.setTargetAtTime(f * 0.25, t, 0.25);
      modulator.connect(index).connect(carrier.frequency);
      const tine = ctx.createOscillator();
      tine.frequency.value = f * 4;
      const tineLevel = this.#gain();
      tineLevel.gain.setValueAtTime(0.05 * velocity, t);
      tineLevel.gain.setTargetAtTime(0, t, 0.03);
      const voice = this.#gain(0.12);
      carrier.connect(voice).connect(amp);
      tine.connect(tineLevel).connect(amp);
      for (const osc of [carrier, modulator, tine]) {
        osc.start(t);
        osc.stop(end + 1.5);
        oscillators.push(osc);
      }
    }
    return this.#handle([amp.gain], oscillators, 0.06);
  }

  arp(t, velocity, pitch, seconds) {
    const osc = this.ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = frequency(pitch);
    const filter = this.#filter("lowpass", 2400, 1.5);
    const amp = this.#gain();
    envelope(amp.gain, t, {
      attack: 0.003,
      peak: velocity,
      decay: 0.15,
      sustain: velocity * 0.3,
      release: 0.06,
      end: t + seconds,
    });
    osc.connect(filter).connect(amp).connect(this.buses.arp);
    osc.start(t);
    osc.stop(t + seconds + 0.4);
    return this.#handle([amp.gain], [osc], 0.02);
  }

  /** The performed voice: a warm two-saw lead that glides between legato notes. */
  leadOn(t, pitch, velocity = 0.85) {
    const ctx = this.ctx;
    const f = frequency(pitch);
    const oscillators = [];
    const filter = this.#filter("lowpass", 900, 2);
    filter.frequency.setValueAtTime(3600, t);
    filter.frequency.setTargetAtTime(1500 + 900 * velocity, t + 0.01, 0.18);
    const amp = this.#gain();
    envelope(amp.gain, t, {
      attack: 0.012,
      peak: velocity,
      decay: 0.3,
      sustain: velocity * 0.72,
    });
    filter.connect(amp).connect(this.buses.lead);
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 5.2;
    const depth = this.#gain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.setTargetAtTime(11, t + 0.35, 0.25);
    vibrato.connect(depth);
    for (const [type, ratio, detune, level] of [
      ["sawtooth", 1, -6, 0.3],
      ["sawtooth", 1, 6, 0.3],
      ["sine", 0.5, 0, 0.35],
    ]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f * ratio;
      osc.detune.value = detune;
      depth.connect(osc.detune);
      osc.connect(this.#gain(level)).connect(filter);
      osc.start(t);
      oscillators.push({ osc, ratio });
    }
    vibrato.start(t);
    return {
      oscillators,
      vibrato,
      depth,
      amp,
      filter,
      start: t,
      released: false,
    };
  }

  leadMove(voice, t, pitch) {
    if (voice.released) return;
    const f = frequency(pitch);
    for (const { osc, ratio } of voice.oscillators) {
      osc.frequency.cancelAndHoldAtTime(t);
      osc.frequency.setTargetAtTime(f * ratio, t, 0.018);
    }
    // A soft re-articulation keeps legato notes distinct without a new attack.
    voice.filter.frequency.cancelAndHoldAtTime(t);
    voice.filter.frequency.setTargetAtTime(2800, t, 0.01);
    voice.filter.frequency.setTargetAtTime(2000, t + 0.04, 0.15);
    voice.depth.gain.cancelAndHoldAtTime(t);
    voice.depth.gain.setTargetAtTime(0, t, 0.02);
    voice.depth.gain.setTargetAtTime(11, t + 0.3, 0.25);
  }

  leadOff(voice, t, release = 0.22) {
    if (voice.released) return;
    voice.released = true;
    voice.amp.gain.cancelAndHoldAtTime(t);
    voice.amp.gain.setTargetAtTime(0, t, release / 3);
    const stop = t + release * 2.5;
    for (const { osc } of voice.oscillators) osc.stop(stop);
    voice.vibrato.stop(stop);
  }

  /** Looped phrases replay as plucks, so they are clearly layers and not the live hand. */
  pluck(t, velocity, pitch, seconds, pan = 0) {
    const ctx = this.ctx;
    const f = frequency(pitch);
    const filter = this.#filter("lowpass", 700, 3);
    filter.frequency.setValueAtTime(4200, t);
    filter.frequency.setTargetAtTime(650, t + 0.005, 0.12);
    const amp = this.#gain();
    const length = Math.min(Math.max(seconds, 0.18), 1.6);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(velocity, t + 0.003);
    amp.gain.setTargetAtTime(velocity * 0.4, t + 0.004, 0.12);
    amp.gain.setTargetAtTime(0, t + length, 0.08);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    filter.connect(amp).connect(panner).connect(this.buses.loop);
    const oscillators = [];
    for (const [type, level] of [
      ["sawtooth", 0.3],
      ["triangle", 0.45],
    ]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f;
      osc.connect(this.#gain(level)).connect(filter);
      osc.start(t);
      osc.stop(t + length + 0.6);
      oscillators.push(osc);
    }
    return this.#handle([amp.gain], oscillators, 0.02);
  }

  // Early release for sustained sounds, used when the band is cut or the piece ends.
  #handle(params, sources, release) {
    return {
      release: (t) => {
        for (const param of params) {
          param.cancelAndHoldAtTime(t);
          param.setTargetAtTime(0, t, release / 3);
        }
        for (const source of sources) {
          try {
            source.stop(t + release * 3);
          } catch {
            /* Already stopped. */
          }
        }
      },
    };
  }
}
