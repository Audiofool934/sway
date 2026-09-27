import { test } from "node:test";
import assert from "node:assert/strict";
import { FlowEngine, wavBlob, VariationScheduler } from "../web/flow-engine.js";

const passage = (left, right, frames = 48000) => [
  new Float32Array(frames).fill(left),
  new Float32Array(frames).fill(right),
];
function render(engine, length = 4800) {
  const left = new Float32Array(length),
    right = new Float32Array(length);
  engine.render(left, right);
  return [left, right];
}
test("source persists through variations and return-to-base is exact before expression", () => {
  const engine = new FlowEngine();
  engine.load(passage(0.2, -0.3), 4);
  engine.intensity = 1;
  engine.control(0, 1);
  engine.start();
  render(engine, 48000);
  engine.queue(passage(0.6, 0.1), "v1");
  engine.control(1, 1);
  render(engine, 48000);
  assert.equal(render(engine)[0].at(-1), Math.fround(0.6));
  engine.control(0, 1);
  const [l, r] = render(engine, 48000);
  assert.equal(l.at(-1), Math.fround(0.2));
  assert.equal(r.at(-1), Math.fround(-0.3));
  assert.equal(engine.frames, 148800);
});
test("variation replacement is quantized to a bar and crossfades without restarting", () => {
  const engine = new FlowEngine();
  engine.load(passage(0.2, 0.3), 4);
  engine.start();
  render(engine, 1000);
  engine.queue(passage(-0.2, -0.3), "v1");
  render(engine, 10999);
  assert.equal(engine.applied, 0);
  render(engine, 2);
  assert.equal(engine.events[0].frame, 12000);
  assert.equal(engine.position, 12001);
  assert.equal(engine.applied, 1);
});
test("intentional ending uses the next bar and reaches silence", () => {
  const engine = new FlowEngine();
  engine.load(passage(0.2, 0.2), 4);
  engine.start();
  render(engine, 1000);
  engine.end();
  render(engine, 24000);
  assert.equal(engine.running, false);
  assert.equal(engine.events.at(-1).frame, 24000);
  assert.ok(render(engine)[0].every((x) => x === 0));
});
test("twenty minutes of the audio clock stay finite and preserve loop alignment", () => {
  const engine = new FlowEngine(1000);
  engine.load(passage(0.2, -0.3, 20000), 8);
  engine.start();
  const left = new Float32Array(128),
    right = new Float32Array(128);
  let frames = 0;
  while (frames < 1200000) {
    if (frames % 16000 === 0) engine.control((frames / 16000) % 2, 0.6);
    engine.render(left, right);
    frames += 128;
    assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite));
  }
  assert.equal(engine.frames, frames);
  assert.equal(engine.position, frames % 20000);
  assert.equal(engine.running, true);
});
test("recordings encode the performed stereo samples", async () => {
  const buffer = await wavBlob([
    new Float32Array([0.25, -0.5, 0, 1]),
  ]).arrayBuffer();
  const view = new DataView(buffer);
  assert.equal(view.getUint32(40, true), 8);
  assert.equal(view.getInt16(44, true), 8192);
  assert.equal(view.getInt16(46, true), -16383);
});

test("live evolution coalesces movement, limits requests and leaves home untouched", () => {
  const scheduler = new VariationScheduler();
  assert.equal(scheduler.update("anchor", 0.5, 0), null);
  assert.equal(scheduler.update("anchor", 0.52, 799), null);
  assert.equal(scheduler.update("anchor", 0.5, 800), 0.6);
  assert.equal(scheduler.update("anchor", 0.5, 9000), null);
  assert.equal(scheduler.update("anchor", 0, 10000), null);
  assert.equal(scheduler.update("anchor", 0.2, 10100), null);
  assert.equal(scheduler.update("anchor", 0.2, 10900), 0.2);
  assert.equal(scheduler.update("anchor", 0.8, 11000), null);
  assert.equal(scheduler.update("anchor", 0.8, 12000), null);
  assert.equal(scheduler.update("anchor", 0.8, 14900), 0.8);
});

test("worklet recording reports its exact audio-clock start and ending", async () => {
  let Worklet;
  globalThis.sampleRate = 48000;
  globalThis.AudioWorkletProcessor = class {
    constructor() {
      this.messages = [];
      this.port = { postMessage: (message) => this.messages.push(message) };
    }
  };
  globalThis.registerProcessor = (name, ctor) => {
    Worklet = ctor;
  };
  await import("../web/flow-worklet.js");
  const player = new Worklet();
  const send = (data) => player.port.onmessage({ data });
  send({ type: "load", channels: passage(0.2, -0.2), bars: 4 });
  send({ type: "play" });
  const output = [new Float32Array(128), new Float32Array(128)];
  player.process([], [output]);
  send({ type: "record", active: true });
  const initial = player.messages.find((m) => m.type === "record-started");
  assert.equal(initial.frame, 128);
  send({ type: "end", immediate: true });
  for (let i = 0; i < 32; i++) player.process([], [output]);
  const chunks = player.messages.filter((m) => m.type === "pcm");
  assert.equal(
    chunks.reduce((n, m) => n + m.chunk.length / 2, 0),
    3840,
  );
  assert.equal(player.messages.filter((m) => m.type === "recorded").length, 1);
  assert.ok(chunks.some((m) => m.chunk.some((x) => x !== 0)));
});
