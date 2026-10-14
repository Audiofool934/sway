import { test } from "node:test";
import assert from "node:assert/strict";
import { REST, SteeredControls } from "../web/steered-controls.js";

function path(controller, seconds, position, start = 0, fps = 60) {
  let result;
  for (let i = 0; i <= seconds * fps; i++) {
    const t = i / fps;
    result = controller.update(position(t), start + t);
  }
  return result;
}
const hand = (x, y = 0.5, id = 1) => ({ id, x, y });

test("slow movement plays calmly and fast movement plays lively", () => {
  const slow = path(new SteeredControls(), 3, (t) => [hand(0.2 + t * 0.1)]);
  assert.ok(slow.activity > REST && slow.activity < 0.4);
  const fast = path(new SteeredControls(), 3, (t) => [
    hand(0.5 + 0.2 * Math.sin(t * Math.PI * 2)),
  ]);
  assert.ok(fast.activity > 0.7);
});

test("stillness, closed hands and tracking loss rest the music", () => {
  const controller = new SteeredControls();
  path(controller, 1, (t) => [hand(0.2 + t * 0.25)]);
  assert.ok(controller.snapshot().activity > REST);
  const held = path(controller, 0.5, () => [hand(0.45)], 1);
  assert.ok(held.activity > REST, "a short pause keeps playing");
  const settled = path(controller, 1, () => [hand(0.45)], 1.5);
  assert.ok(settled.activity < REST);
  const resume = path(controller, 0.5, (t) => [hand(0.45 + t * 0.2)], 2.5);
  assert.ok(resume.activity > REST);
  path(controller, 1, () => [{ ...hand(0.55), fist: true }], 3);
  assert.ok(controller.snapshot().activity < REST);
  path(controller, 0.5, (t) => [hand(0.45 + t * 0.2)], 4);
  path(controller, 1, () => [], 4.5);
  assert.ok(controller.snapshot().activity < REST);
});

test("height follows the hands, and the distance between two hands opens the spread", () => {
  const controller = new SteeredControls();
  const low = path(controller, 1, (t) => [hand(0.3 + t * 0.05, 0.8, 4)]);
  assert.ok(low.height < 0.1);
  const high = path(controller, 1, (t) => [hand(0.35 + t * 0.05, 0.2, 4)], 1);
  assert.ok(high.height > 0.9);
  const wide = path(
    controller,
    1,
    (t) => [hand(0.15, 0.5 + t * 0.05, 4), hand(0.85, 0.5, 8)],
    2,
  );
  assert.ok(wide.spread > 0.95);
  const close = path(
    controller,
    1,
    (t) => [hand(0.45, 0.5 + t * 0.05, 4), hand(0.5, 0.5, 8)],
    3,
  );
  assert.ok(close.spread < 0.15);
});

test("small tracking noise does not count as movement", () => {
  const state = path(new SteeredControls(), 4, (t) => [
    hand(0.5 + 0.0003 * Math.sin(t * 100), 0.5),
  ]);
  assert.ok(state.activity < REST);
});

test("the camera's lower sampling rate gives the same activity", () => {
  const move = (t) => [hand(0.5 + 0.2 * Math.sin(t * Math.PI * 2))];
  const camera = path(new SteeredControls(), 3, move, 0, 12);
  const pointer = path(new SteeredControls(), 3, move, 0, 60);
  assert.ok(Math.abs(camera.activity - pointer.activity) < 0.1);
});
