import { test } from "node:test";
import assert from "node:assert/strict";
import { StereoBuffer } from "../web/audio-buffer.js";

test("stereo survives buffering and resampling to 44.1 kHz", () => {
  const queue = new StereoBuffer(44100);
  const pcm = new Float32Array(18000 * 2);
  for (let i = 0; i < 18000; i++) {
    pcm[i * 2] = 0.25;
    pcm[i * 2 + 1] = -0.5;
  }
  queue.push(pcm);
  const left = new Float32Array(4410),
    right = new Float32Array(4410);
  queue.render(left, right);
  assert.equal(left[4000], 0.25);
  assert.equal(right[4000], -0.5);
  assert.ok(Math.abs(queue.queuedMs - 275) < 0.1);
  assert.equal(queue.underruns, 0);
});
test("underruns are counted once and the queue recovers after refilling", () => {
  const queue = new StereoBuffer();
  queue.push(new Float32Array(16000 * 2).fill(0.2));
  const left = new Float32Array(24000),
    right = new Float32Array(24000);
  queue.render(left, right);
  assert.equal(queue.underruns, 1);
  assert.ok(left.every(Number.isFinite));
  assert.ok(Math.abs(left.at(-1)) < 0.0001);
  queue.push(new Float32Array(16000 * 2).fill(0.3));
  queue.render(new Float32Array(128), new Float32Array(128));
  assert.equal(queue.playing, true);
});
test("a stalled tab catches up instead of keeping unbounded latency", () => {
  const queue = new StereoBuffer();
  queue.push(new Float32Array(40000 * 2));
  assert.equal(queue.queuedMs, 320);
  assert.equal(queue.dropped, 24640);
  queue.reset();
  assert.equal(queue.queuedMs, 0);
  assert.equal(queue.dropped, 0);
});
