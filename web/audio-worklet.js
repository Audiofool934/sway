import { StereoBuffer } from "./audio-buffer.js";

class SwayPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = new StereoBuffer(sampleRate);
    this.blocks = 0;
    this.port.onmessage = ({ data }) => {
      if (data === "reset") this.queue.reset();
      else this.queue.push(new Float32Array(data));
    };
  }
  process(inputs, outputs) {
    const [left, right] = outputs[0];
    this.queue.render(left, right);
    if (++this.blocks % 100 === 0)
      this.port.postMessage({
        queuedMs: this.queue.queuedMs,
        underruns: this.queue.underruns,
        dropped: this.queue.dropped,
      });
    return true;
  }
}
registerProcessor("sway-player", SwayPlayer);
