// Bounded stereo PCM queue with linear resampling and an explicit underrun count.
export class StereoBuffer {
  constructor(outputRate = 48000, { targetMs = 320, maxMs = 800 } = {}) {
    this.capacity = 48000;
    this.samples = new Float32Array(this.capacity * 2);
    this.ratio = 48000 / outputRate;
    this.targetFrames = Math.round(targetMs * 48);
    this.maxFrames = Math.round(maxMs * 48);
    this.reset();
  }
  reset() {
    this.read = 0;
    this.write = 0;
    this.playing = false;
    this.underruns = 0;
    this.dropped = 0;
    this.last = [0, 0];
    this.fade = 0;
  }
  push(input) {
    const frames = input.length / 2;
    for (let i = 0; i < frames; i++) {
      const index = (this.write % this.capacity) * 2;
      this.samples[index] = input[i * 2];
      this.samples[index + 1] = input[i * 2 + 1];
      this.write++;
    }
    // Catch up if the browser stalls rather than accumulating seconds of delay.
    if (this.write - this.read > this.maxFrames) {
      this.dropped += Math.floor(this.write - this.read - this.targetFrames);
      this.read = this.write - this.targetFrames;
      this.fade = 0;
    }
  }
  render(left, right) {
    if (!this.playing && this.write - this.read >= this.targetFrames) {
      this.playing = true;
      this.fade = 0;
    }
    for (let i = 0; i < left.length; i++) {
      if (this.playing && this.write - this.read < 2) {
        this.playing = false;
        this.underruns++;
      }
      if (this.playing) {
        const frame = Math.floor(this.read),
          fraction = this.read - frame;
        const a = (frame % this.capacity) * 2,
          b = ((frame + 1) % this.capacity) * 2;
        this.fade = Math.min(1, this.fade + 1 / 240);
        for (let ch = 0; ch < 2; ch++) {
          this.last[ch] =
            (this.samples[a + ch] * (1 - fraction) +
              this.samples[b + ch] * fraction) *
            this.fade;
        }
        this.read += this.ratio;
      } else {
        this.last[0] *= 0.97;
        this.last[1] *= 0.97;
      }
      left[i] = this.last[0];
      right[i] = this.last[1];
    }
  }
  get queuedMs() {
    return Math.max(0, this.write - this.read) / 48;
  }
}
