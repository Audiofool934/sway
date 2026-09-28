// Passes the master mix through unchanged and, while recording, posts it in blocks.

const BLOCK = 16384;

class Recorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.#reset();
    this.port.onmessage = ({ data }) => {
      if (data === "start") {
        this.#reset();
        this.recording = true;
      } else if (data === "stop") {
        this.#flush();
        this.recording = false;
        this.port.postMessage({ done: true });
      }
    };
  }

  #reset() {
    this.left = new Float32Array(BLOCK);
    this.right = new Float32Array(BLOCK);
    this.filled = 0;
  }

  #flush() {
    if (!this.filled) return;
    const left = this.left.slice(0, this.filled);
    const right = this.right.slice(0, this.filled);
    this.port.postMessage({ left, right }, [left.buffer, right.buffer]);
    this.filled = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    const left = input[0];
    const right = input[1] ?? input[0];
    if (!left) return true;
    output[0]?.set(left);
    output[1]?.set(right);
    if (this.recording) {
      this.left.set(left, this.filled);
      this.right.set(right, this.filled);
      this.filled += left.length;
      if (this.filled + left.length > BLOCK) this.#flush();
    }
    return true;
  }
}

registerProcessor("sway-recorder", Recorder);
