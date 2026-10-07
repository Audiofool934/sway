import { StereoBuffer } from "./audio-buffer.js";

class ThereminPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = new StereoBuffer(sampleRate, { targetMs: 160, maxMs: 280 });
    this.blocks = 0;
    this.port.onmessage = ({ data }) => {
      if (data === "reset") this.queue.reset();
      else this.queue.push(new Float32Array(data));
    };
  }
  process(inputs, outputs) {
    const [left, right] = outputs[0];
    this.queue.render(left, right);
    if (++this.blocks % 50 === 0)
      this.port.postMessage({
        queuedMs: this.queue.queuedMs,
        underruns: this.queue.underruns,
        dropped: this.queue.dropped,
      });
    return true;
  }
}
registerProcessor("theremin-player", ThereminPlayer);
