// The audio clock owns playback, phrase boundaries and fades. No network dependency.
export class FlowEngine {
  constructor(rate = 48000) {
    this.rate = rate;
    this.running = false;
    this.frames = 0;
    this.position = 0;
    this.morph = this.targetMorph = 0;
    this.intensity = this.targetIntensity = 0.6;
    this.filter = [0, 0];
    this.events = [];
    this.applied = 0;
  }
  load(channels, bars = 8) {
    if (
      channels.length !== 2 ||
      channels[0].length !== channels[1].length ||
      channels[0].length < this.rate ||
      !channels.every((c) => c.every(Number.isFinite))
    )
      throw new Error("Invalid stereo passage");
    this.base = channels;
    this.barFrames = channels[0].length / bars;
    this.variation = this.previous = this.pending = null;
    this.variationId = null;
    this.morph = this.targetMorph = 0;
    this.frames = this.position = this.applied = 0;
    this.filter = [0, 0];
  }
  queue(channels, id) {
    if (
      !this.base ||
      channels.length !== 2 ||
      channels.some(
        (c) => c.length !== this.base[0].length || !c.every(Number.isFinite),
      )
    )
      throw new Error("Variation and source must share the same timeline");
    this.pending = {
      channels,
      id,
      at: this.running
        ? Math.ceil((this.frames + 1) / this.barFrames) * this.barFrames
        : this.frames,
    };
  }
  control(morph, intensity, sequence = 0) {
    if (Number.isFinite(morph))
      this.targetMorph = Math.max(0, Math.min(1, morph));
    if (Number.isFinite(intensity))
      this.targetIntensity = Math.max(0, Math.min(1, intensity));
    this.controlSequence = sequence;
  }
  start() {
    if (!this.base) return;
    this.running = true;
    this.ending = null;
    this.fadeIn = this.rate * 0.03;
  }
  end(immediate = false) {
    if (!this.running) return;
    const begin = immediate
      ? this.frames
      : Math.ceil((this.frames + 1) / this.barFrames) * this.barFrames;
    this.ending = {
      begin,
      end: begin + (immediate ? this.rate * 0.08 : this.barFrames),
    };
  }
  render(left, right) {
    left.fill(0);
    right.fill(0);
    if (!this.running || !this.base) return;
    const smooth = 1 - Math.exp(-1 / (this.rate * 0.06));
    const alpha =
      1 -
      Math.exp((-2 * Math.PI * (800 * 18 ** this.targetIntensity)) / this.rate);
    for (let i = 0; i < left.length; i++) {
      if (this.pending && this.frames >= this.pending.at) {
        this.previous = this.variation || this.base;
        this.variation = this.pending.channels;
        this.variationId = this.pending.id;
        this.swapStart = this.frames;
        this.events.push({
          type: "variation-applied",
          id: this.pending.id,
          frame: this.frames,
        });
        this.applied++;
        this.pending = null;
      }
      if (this.ending && this.frames >= this.ending.end) {
        this.running = false;
        this.events.push({ type: "ended", frame: this.frames });
        break;
      }
      this.morph += (this.targetMorph - this.morph) * smooth;
      if (Math.abs(this.targetMorph - this.morph) < 0.00001)
        this.morph = this.targetMorph;
      this.intensity += (this.targetIntensity - this.intensity) * smooth;
      const swap = this.previous
        ? Math.min(1, (this.frames - this.swapStart) / (this.barFrames / 4))
        : 1;
      let envelope = 1;
      if (this.fadeIn > 0) envelope *= 1 - this.fadeIn-- / (this.rate * 0.03);
      if (this.ending && this.frames > this.ending.begin)
        envelope *=
          (this.ending.end - this.frames) /
          (this.ending.end - this.ending.begin);
      for (let channel = 0; channel < 2; channel++) {
        const base = this.base[channel][this.position];
        let variation = this.variation?.[channel][this.position] ?? base;
        if (this.previous)
          variation =
            this.previous[channel][this.position] * (1 - swap) +
            variation * swap;
        const sample = base * (1 - this.morph) + variation * this.morph;
        this.filter[channel] += alpha * (sample - this.filter[channel]);
        const colored =
          sample * this.intensity + this.filter[channel] * (1 - this.intensity);
        (channel ? right : left)[i] =
          colored * (0.5 + 0.5 * this.intensity) * envelope;
      }
      if (swap === 1) this.previous = null;
      this.position = (this.position + 1) % this.base[0].length;
      this.frames++;
    }
  }
  snapshot() {
    return {
      running: this.running,
      frame: this.frames,
      position: this.position,
      seconds: this.frames / this.rate,
      bar: Math.floor(this.position / this.barFrames) + 1,
      morph: this.morph,
      intensity: this.intensity,
      pending: this.pending?.id ?? null,
      variation: this.variationId ?? null,
      ending: Boolean(this.ending),
      applied: this.applied,
      controlSequence: this.controlSequence ?? 0,
    };
  }
}

export class VariationScheduler {
  constructor() {
    this.candidate = null;
    this.since = 0;
    this.sentAt = -Infinity;
    this.last = null;
  }
  update(key, amount, now) {
    const bucket = Math.round(amount * 5);
    const candidate = bucket ? `${key}:${bucket}` : null;
    if (candidate !== this.candidate) {
      this.candidate = candidate;
      this.since = now;
    }
    if (
      !candidate ||
      candidate === this.last ||
      now - this.since < 800 ||
      now - this.sentAt < 4000
    )
      return null;
    this.last = candidate;
    this.sentAt = now;
    return bucket / 5;
  }
}

export function wavBlob(chunks, rate = 48000) {
  const samples = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new ArrayBuffer(44 + samples * 2),
    view = new DataView(bytes);
  const text = (at, value) =>
    [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples * 2, true);
  let offset = 44;
  for (const chunk of chunks)
    for (const sample of chunk) {
      view.setInt16(
        offset,
        Math.round(Math.max(-1, Math.min(1, sample)) * 32767),
        true,
      );
      offset += 2;
    }
  return new Blob([bytes], { type: "audio/wav" });
}
