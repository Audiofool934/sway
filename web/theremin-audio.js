import { encodeWav } from "./instrument/wav.js";

export class ThereminAudio {
  constructor() {
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
    this.filter.frequency.value = 4500;
    this.filter.Q.value = 0.35;
    this.expression = ctx.createGain();
    this.expression.gain.value = 0;
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
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -10;
    compressor.knee.value = 8;
    compressor.ratio.value = 5;
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
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
    const now = this.context.currentTime;
    // These expression controls shape the same model stream that receives the gesture.
    this.expression.gain.setTargetAtTime(
      state.active ? 0.25 + state.energy * 0.65 : 0,
      now,
      state.active ? 0.04 : 0.16,
    );
    this.filter.frequency.setTargetAtTime(1700 + state.spread * 6200, now, 0.1);
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
