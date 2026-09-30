import { test } from "node:test";
import assert from "node:assert/strict";
import { FlowHands } from "../web/flow-hands.js";

const hand = (side, x, y) => ({ side, points: [{ x, y }] });
const pose = (y = 0.55, x = 0.65) => [
  hand("Right", 0.3, y),
  hand("Left", x, 0.6),
];
const values = { morph: 0, intensity: 0.6 };
const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-8);

test("hands take control automatically from the current sound, with no calibration click", () => {
  const controls = new FlowHands();
  assert.deepEqual(controls.update(pose(), values, 0), values);
  const moved = controls.update(pose(0.4, 0.45), values, 100);
  close(moved.intensity, 0.9);
  close(moved.morph, 0.5);
});

test("either hand works alone and does not change the other hand's control", () => {
  const controls = new FlowHands();
  assert.deepEqual(controls.update([hand("Right", 0.3, 0.5)], values, 0), {
    intensity: 0.6,
  });
  close(controls.update([hand("Right", 0.3, 0.4)], values, 50).intensity, 0.8);
  assert.deepEqual(controls.visible, { intensity: true, morph: false });
});

test("hand loss holds the sound and re-entry picks up without a jump", () => {
  const controls = new FlowHands();
  controls.update(pose(), values, 0);
  const moved = controls.update(pose(0.4, 0.45), values, 100);
  assert.deepEqual(controls.update([], moved, 500), {});
  assert.deepEqual(controls.visible, { intensity: false, morph: false });
  assert.deepEqual(controls.update(pose(0.8, 0.8), moved, 1000), moved);
  const resumed = controls.update(pose(0.75, 0.7), moved, 1050);
  close(resumed.intensity, 1);
  close(resumed.morph, 0.75);
});

test("a brief tracking miss does not move the comfortable pose", () => {
  const controls = new FlowHands();
  controls.update(pose(), values, 0);
  controls.update([], values, 80);
  close(controls.update(pose(0.4), values, 150).intensity, 0.9);
});

test("slow tracking frames do not continually reset a visible hand's reference", () => {
  const controls = new FlowHands();
  controls.update(pose(), values, 0);
  const moved = controls.update(pose(0.4, 0.45), values, 600);
  close(moved.intensity, 0.9);
  close(moved.morph, 0.5);
});

test("dragging one slider keeps the other hand active; releasing restores hand control", () => {
  const controls = new FlowHands();
  controls.update(pose(), values, 0);
  controls.hold("intensity", true);
  const manual = { morph: 0, intensity: 0.3 };
  const during = controls.update(pose(0.2, 0.45), manual, 100);
  assert.equal(during.intensity, undefined);
  close(during.morph, 0.5);
  controls.hold("intensity", false);
  close(controls.update(pose(0.2, 0.45), manual, 150).intensity, 0.3);
  close(controls.update(pose(0.1, 0.45), manual, 200).intensity, 0.5);
});

test("keyboard slider changes and return-to-original preserve the other hand and never lock out", () => {
  const controls = new FlowHands();
  controls.update(pose(), values, 0);
  controls.update(pose(0.45, 0.45), values, 100);
  controls.recenter(["morph"]);
  const home = { intensity: 0.8, morph: 0 };
  assert.deepEqual(controls.update(pose(0.45, 0.45), home, 150), home);
  const continued = controls.update(pose(0.35, 0.35), home, 200);
  close(continued.morph, 0.25);
  close(continued.intensity, 1);
});

test("malformed tracking output cannot send non-finite musical controls", () => {
  const controls = new FlowHands();
  const bad = [{ side: "Right", points: [] }, hand("Left", NaN, 0.5)];
  assert.deepEqual(controls.update(bad, values, 0), {});
  assert.deepEqual(controls.visible, { intensity: false, morph: false });
});
