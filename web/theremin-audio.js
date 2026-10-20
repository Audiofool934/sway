import { encodeWav } from "./instrument/wav.js";

function whiteNoise(ctx, seconds) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  return buffer;
}

export class ThereminAudio {
  // With `expression` off, the page plays the model's output as it is: the gain and
  // the low-pass filter stay open, and control() changes nothing.
  constructor({ expression = true } = {}) {
    this.expressive = expression;
    this.context = new AudioContext({
      latencyHint: "interactive",
      sampleRate: 48000,
    });
    this.left = [];
    this.right = [];
    this.frames = 0;
    this.stats = { queuedMs: 0, underruns: 0, dropped: 0 };
  }

  async open() {
    const ctx = this.context;
    await ctx.resume();
    await Promise.all([
      ctx.audioWorklet.addModule("/theremin-worklet.js"),
      ctx.audioWorklet.addModule("/instrument/recorder-worklet.js"),
    ]);
    this.player = new AudioWorkletNode(ctx, "theremin-player", {
      outputChannelCount: [2],
    });
    this.player.port.onmessage = ({ data }) => {
      this.stats = data;
    };
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = this.expressive ? 4500 : 16000;
    this.filter.Q.value = 0.35;
    this.expression = ctx.createGain();
    this.expression.gain.value = this.expressive ? 0 : 1;
    const highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 45;
    const room = ctx.createConvolver();
    const impulse = ctx.createBuffer(2, ctx.sampleRate * 1.7, ctx.sampleRate);
    let seed = 17;
    for (let ch = 0; ch < 2; ch++) {
      const channel = impulse.getChannelData(ch);
      for (let i = 0; i < channel.length; i++) {
        seed = (1664525 * seed + 1013904223) >>> 0;
        channel[i] =
          (seed / 2 ** 31 - 1) * Math.exp(-i / (ctx.sampleRate * 0.28));
      }
    }
    room.buffer = impulse;
    const wet = ctx.createGain();
    wet.gain.value = 0.17;
    const compressor = (this.compressor = ctx.createDynamicsCompressor());
    compressor.threshold.value = -10;
    compressor.knee.value = 8;
    compressor.ratio.value = 5;
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    // A limiter keeps the loudest peaks below full scale at any volume.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.1;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.recorder = new AudioWorkletNode(ctx, "sway-recorder", {
      outputChannelCount: [2],
    });
    this.recorder.port.onmessage = ({ data }) => {
      if (data.done) {
        this.recorded?.();
        return;
      }
      this.left.push(data.left);
      this.right.push(data.right);
      this.frames += data.left.length;
    };
    this.player.connect(highpass).connect(this.filter).connect(this.expression);
    this.expression.connect(compressor);
    this.expression.connect(room).connect(wet).connect(compressor);
    compressor
      .connect(this.master)
      .connect(limiter)
      .connect(this.analyser)
      .connect(this.recorder)
      .connect(ctx.destination);
  }

  record() {
    this.recorder.port.postMessage("start");
  }
  push(buffer) {
    this.player.port.postMessage(buffer, [buffer]);
  }
  control(state) {
    if (!this.expressive) return;
    const now = this.context.currentTime;
    // These expression controls shape the same model stream that receives the gesture.
    this.expression.gain.setTargetAtTime(
      state.active ? 0.25 + state.energy * 0.65 : 0,
      now,
      state.active ? 0.04 : 0.16,
    );
    this.filter.frequency.setTargetAtTime(1700 + state.spread * 6200, now, 0.1);
  }
  // A clap's sign: filtered noise swells from now until `at`, in context time, where
  // the new section lands with a soft low impact. Calling it again moves the landing.
  cue(at) {
    const ctx = this.context;
    const now = ctx.currentTime;
    at = Math.max(at, now + 0.3);
    if (!this.swell) {
      const noise = ctx.createBufferSource();
      noise.buffer = this.noise ??= whiteNoise(ctx, 2);
      noise.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.Q.value = 1.2;
      band.frequency.value = 300;
      const level = ctx.createGain();
      level.gain.value = 0;
      // Past the expression stage, so that the volume the player sets does not dim it.
      noise.connect(band).connect(level).connect(this.compressor);
      noise.start(now);
      const swell = { noise, band, level };
      noise.onended = () => {
        if (this.swell === swell) this.swell = null;
      };
      this.swell = swell;
    }
    const { noise, band, level } = this.swell;
    for (const param of [band.frequency, level.gain]) {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
    }
    band.frequency.exponentialRampToValueAtTime(5000, at);
    level.gain.linearRampToValueAtTime(0.2, at);
    level.gain.setTargetAtTime(0, at, 0.06);
    noise.stop(at + 0.5);
    this.swell.impact?.stop();
    const boom = ctx.createOscillator();
    boom.frequency.setValueAtTime(70, at);
    boom.frequency.exponentialRampToValueAtTime(38, at + 0.5);
    const thump = ctx.createGain();
    thump.gain.setValueAtTime(0, at);
    thump.gain.linearRampToValueAtTime(0.45, at + 0.01);
    thump.gain.setTargetAtTime(0, at + 0.01, 0.15);
    boom.connect(thump).connect(this.compressor);
    boom.start(at);
    boom.stop(at + 0.9);
    this.swell.impact = boom;
  }

  // Fade a swell that will not land, such as a preparation that was let go.
  cancelCue() {
    if (!this.swell) return;
    const now = this.context.currentTime;
    const { noise, level, impact } = this.swell;
    level.gain.cancelScheduledValues(now);
    level.gain.setValueAtTime(level.gain.value, now);
    level.gain.setTargetAtTime(0, now, 0.06);
    noise.stop(now + 0.4);
    impact?.stop();
    this.swell.impact = null;
  }

  // The conductor's dynamics, at once: a gain on the model's output, from 0 to 1.
  level(value) {
    if (this.expressive) return;
    this.expression.gain.setTargetAtTime(value, this.context.currentTime, 0.05);
  }

  volume(value) {
    this.master?.gain.setTargetAtTime(value, this.context.currentTime, 0.02);
  }

  async close({ save = true } = {}) {
    if (this.context.state === "closed") return null;
    if (save && this.expression && this.context.state === "running") {
      const now = this.context.currentTime;
      this.expression.gain.cancelScheduledValues(now);
      this.expression.gain.setTargetAtTime(0, now, 0.08);
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(this.master.gain.value, now);
      this.master.gain.linearRampToValueAtTime(0, now + 0.9);
      await new Promise((resolve) => setTimeout(resolve, 950));
    }
    if (this.recorder && save) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 1000);
        this.recorded = () => {
          clearTimeout(timer);
          resolve();
        };
        this.recorder.port.postMessage("stop");
      });
    }
    await this.context.close();
    if (!save || !this.frames) return null;
    const merge = (chunks) => {
      const result = new Float32Array(this.frames);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      return result;
    };
    const wav = encodeWav(
      merge(this.left),
      merge(this.right),
      this.context.sampleRate,
    );
    this.left = this.right = [];
    return new Blob([wav], { type: "audio/wav" });
  }
}
