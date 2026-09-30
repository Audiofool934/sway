import { FlowEngine } from "./flow-engine.js";

class FlowPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.engine = new FlowEngine(sampleRate);
    this.recording = false;
    this.recorded = 0;
    this.capture = new Float32Array(8192);
    this.captureIndex = 0;
    this.ticks = 0;
    this.port.onmessage = ({ data }) => {
      try {
        if (data.type === "load") this.engine.load(data.channels, data.bars);
        if (data.type === "variation")
          this.engine.queue(data.channels, data.id);
        if (data.type === "control") {
          this.engine.control(data.morph, data.intensity, data.sequence);
          this.port.postMessage({
            type: "control-applied",
            frame: this.engine.frames,
            morph: this.engine.targetMorph,
            intensity: this.engine.targetIntensity,
            sequence: data.sequence,
          });
        }
        if (data.type === "play") this.engine.start();
        if (data.type === "end") this.engine.end(data.immediate);
        if (data.type === "record") {
          if (!data.active) this.flush();
          this.recording = data.active;
          this.recorded = 0;
          if (data.active)
            this.port.postMessage({
              type: "record-started",
              ...this.engine.snapshot(),
            });
          else this.port.postMessage({ type: "recorded" });
        }
      } catch (error) {
        this.port.postMessage({ type: "error", message: error.message });
      }
    };
  }
  flush() {
    if (this.captureIndex) {
      const chunk = this.capture.slice(0, this.captureIndex);
      this.port.postMessage({ type: "pcm", chunk }, [chunk.buffer]);
      this.captureIndex = 0;
    }
  }
  process(inputs, outputs) {
    const [left, right] = outputs[0];
    const before = this.engine.frames;
    this.engine.render(left, right);
    const rendered = this.engine.frames - before;
    if (this.recording) {
      for (let i = 0; i < rendered; i++) {
        this.capture[this.captureIndex++] = left[i];
        this.capture[this.captureIndex++] = right[i];
        if (this.captureIndex === this.capture.length) this.flush();
      }
      this.recorded += rendered;
      if (!this.engine.running || this.recorded >= sampleRate * 600) {
        this.flush();
        this.recording = false;
        this.port.postMessage({ type: "recorded" });
      }
    }
    for (const event of this.engine.events.splice(0))
      this.port.postMessage(event);
    if (++this.ticks % 40 === 0)
      this.port.postMessage({ type: "state", ...this.engine.snapshot() });
    return true;
  }
}
registerProcessor("sway-flow", FlowPlayer);
