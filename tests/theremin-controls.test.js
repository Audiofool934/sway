import { test } from "node:test";
import assert from "node:assert/strict";
import { ThereminControls } from "../web/theremin-controls.js";
import { StereoBuffer } from "../web/audio-buffer.js";

function path(controller, seconds, position, start = 0) {
  let result;
  for (let i = 0; i <= seconds * 60; i++) {
    const t = i / 60;
    result = controller.update(position(t), start + t);
  }
  return result;
}
const hand = (x, y = 0.5, id = 1) => ({ id, x, y });

test("a long sweep sustains bowing; repeated short strokes develop articulation", () => {
  const bow = new ThereminControls();
  const sustained = path(bow, 3, (t) => [hand(0.2 + t * 0.13)]);
  assert.ok(sustained.active && sustained.energy > 0.4);
  assert.ok(sustained.grain < 0.1 && sustained.accent === 0);
  const pluck = new ThereminControls();
  const articulated = path(pluck, 3, (t) => [
    hand(0.5 + 0.07 * Math.sin(t * Math.PI * 6)),
  ]);
  assert.ok(articulated.grain > 0.55);
  assert.ok(articulated.accent >= 8 && articulated.accent <= 18);
});

test("stillness, closed hands and tracking loss let a phrase settle", () => {
  const controller = new ThereminControls();
  path(controller, 1, (t) => [hand(0.2 + t * 0.25)]);
  assert.ok(controller.snapshot().active);
  const settled = path(controller, 3, () => [hand(0.45)], 1);
  assert.ok(settled.energy < 0.025 && !settled.active);
  const resume = path(controller, 1, (t) => [hand(0.45 + t * 0.1)], 4);
  assert.ok(resume.active && resume.energy > 0.4);
  assert.equal(
    controller.update([{ ...hand(0.55), fist: true }], 5.02).active,
    false,
  );
  assert.equal(controller.update([], 5.04).active, false);
});

test("either hand and the distance between two hands control the same instrument", () => {
  const controller = new ThereminControls();
  const left = path(controller, 1, (t) => [hand(0.3 + t * 0.05, 0.5, 4)]);
  const pitch = left.pitch;
  const spread = path(
    controller,
    1,
    () => [hand(0.15, 0.5, 4), hand(0.85, 0.5, 8)],
    1,
  );
  assert.ok(spread.spread > 0.95);
  assert.equal(spread.pitch, pitch);
  const higher = path(controller, 1, () => [hand(0.5, 0.2, 8)], 2);
  assert.ok(higher.pitch > pitch);
});

test("small position noise cannot keep rearticulating a held note", () => {
  const controller = new ThereminControls();
  const state = path(controller, 4, (t) => [
    hand(0.5 + 0.0003 * Math.sin(t * 100), 0.5),
  ]);
  assert.equal(state.accent, 0);
  assert.ok(state.grain < 0.01 && state.energy < 0.025);
});

test("short streaming buffer starts in 120 ms and bounds accumulated latency", () => {
  const queue = new StereoBuffer(48000, { targetMs: 100, maxMs: 240 });
  const packet = new Float32Array(1920 * 2).fill(0.2);
  queue.push(packet);
  queue.push(packet);
  const left = new Float32Array(128),
    right = new Float32Array(128);
  queue.render(left, right);
  assert.ok(left.every((x) => x === 0));
  queue.push(packet);
  queue.render(left, right);
  assert.ok(left.some((x) => x > 0));
  for (let i = 0; i < 10; i++) queue.push(packet);
  assert.ok(queue.dropped > 0 && queue.queuedMs <= 240);
});

test("short strokes remain distinct at the bounded camera sampling rate", () => {
  const controller = new ThereminControls();
  for (let i = 0; i < 30; i++) {
    const time = i / 10;
    controller.update([hand(0.5 + 0.08 * Math.sin(time * Math.PI * 4))], time);
  }
  const state = controller.snapshot();
  assert.ok(state.accent >= 6 && state.grain > 0.55);
});
