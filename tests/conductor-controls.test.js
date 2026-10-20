import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ConductorControls,
  VOICE_PLACES,
  voiceWeights,
} from "../web/conductor-controls.js";

function path(controller, seconds, hands, start = 0, fps = 30) {
  let result;
  for (let i = 0; i <= seconds * fps; i++) {
    const t = i / fps;
    result = controller.update(hands(t), start + t);
  }
  return result;
}
const right = (x, y, extra = {}) => ({ id: 1, side: "Right", x, y, ...extra });
const left = (x, y, extra = {}) => ({ id: 2, side: "Left", x, y, ...extra });

test("big, fast beats play loud and driving; small, slow ones soft and calm", () => {
  const big = path(new ConductorControls(), 3, (t) => [
    right(0.65 + 0.2 * Math.sin(t * 9), 0.5 + 0.15 * Math.cos(t * 9)),
  ]);
  assert.ok(big.dynamics > 0.8 && big.energy > 0.8 && !big.hush);
  const small = path(new ConductorControls(), 3, (t) => [
    right(0.65 + 0.02 * Math.sin(t * 2), 0.5),
  ]);
  assert.ok(small.dynamics < 0.15 && small.energy < 0.1 && !small.hush);
});

test("stillness or a fist hushes the music, and moving again plays", () => {
  const controller = new ConductorControls();
  path(controller, 1, (t) => [right(0.6 + 0.1 * Math.sin(t * 6), 0.5)]);
  assert.equal(controller.snapshot().hush, false);
  assert.equal(path(controller, 1, () => [right(0.6, 0.5)], 1).hush, true);
  path(controller, 0.5, (t) => [right(0.6 + 0.1 * Math.sin(t * 6), 0.5)], 2);
  assert.equal(controller.snapshot().hush, false);
  const fist = controller.update([right(0.62, 0.5, { fist: true })], 2.55);
  assert.equal(fist.hush, true);
});

test("the left hand's place chooses the voice and its height brings it forward", () => {
  const controller = new ConductorControls();
  const beat = (t) => right(0.8 + 0.05 * Math.sin(t * 6), 0.5);
  const violins = path(controller, 1, (t) => [beat(t), left(0.1, 0.25)]);
  assert.ok(violins.voice < 0.05 && violins.forward > 0.95);
  const brass = path(controller, 1, (t) => [beat(t), left(0.4, 0.5)], 1);
  assert.ok(Math.abs(brass.voice - 0.5) < 0.05);
  assert.ok(Math.abs(brass.forward - 0.55) < 0.05);
  // Out of view, the balance holds: losing a hand changes nothing.
  const held = path(controller, 1, (t) => [beat(t)], 2);
  assert.ok(Math.abs(held.voice - brass.voice) < 1e-9);
});

test("one hand conducts, whichever it is", () => {
  const controller = new ConductorControls();
  const alone = path(controller, 2, (t) => [
    left(0.3 + 0.2 * Math.sin(t * 9), 0.5),
  ]);
  assert.ok(alone.dynamics > 0.7 && alone.voice === 0.5);
  const leftHanded = new ConductorControls({ leftHanded: true });
  const both = path(leftHanded, 2, (t) => [
    right(0.8, 0.3),
    left(0.3 + 0.2 * Math.sin(t * 9), 0.5),
  ]);
  assert.ok(both.dynamics > 0.7 && both.forward > 0.9); // The right hand balances.
});

test("a pinch asks for short notes, an open palm for long ones", () => {
  const beat = (t, pinch) =>
    right(0.6 + 0.05 * Math.sin(t * 6), 0.5, { shape: { pinch } });
  const pinched = path(new ConductorControls(), 1, (t) => [beat(t, 0.15)]);
  assert.ok(pinched.articulation > 0.95);
  const open = path(new ConductorControls(), 1, (t) => [beat(t, 0.9)]);
  assert.ok(open.articulation < 0.05);
});

test("both hands held up prepare, and bringing them down moves on", () => {
  const controller = new ConductorControls();
  path(controller, 1, (t) => [
    right(0.7 + 0.05 * Math.sin(t * 6), 0.5),
    left(0.3, 0.6),
  ]);
  const before = controller.snapshot();
  const up = path(controller, 0.5, () => [right(0.7, 0.2), left(0.3, 0.2)], 1);
  assert.ok(up.prepared && up.cue === 0);
  assert.ok(Math.abs(up.forward - before.forward) < 1e-9); // The balance holds.
  const down = path(
    controller,
    0.3,
    (t) => [right(0.7, 0.2 + t * 2), left(0.3, 0.2 + t * 2)],
    1.5,
  );
  assert.equal(down.cue, 1);
  assert.equal(down.prepared, false);
});

test("lowering the hands slowly, or one at a time, does not move on", () => {
  const controller = new ConductorControls();
  path(controller, 0.5, () => [right(0.7, 0.2), left(0.3, 0.2)]);
  assert.equal(controller.snapshot().prepared, true);
  const slow = path(
    controller,
    2,
    (t) => [right(0.7, 0.2 + t * 0.3), left(0.3, 0.2 + t * 0.3)],
    0.5,
  );
  assert.equal(slow.cue, 0);
  assert.equal(slow.prepared, false);
  const brief = path(
    controller,
    0.1,
    () => [right(0.7, 0.2), left(0.3, 0.2)],
    3,
  );
  assert.equal(brief.prepared, false); // Up for less than a quarter of a second.
});

test("the voices' weights and places match the server's", () => {
  assert.deepEqual(voiceWeights(0, 1), [0, 1, 0, 0]);
  assert.deepEqual(voiceWeights(0.25, 1), [0, 0.5, 0.5, 0]);
  assert.deepEqual(voiceWeights(1, 0.5), [0.5, 0, 0, 0.5]);
  assert.deepEqual(VOICE_PLACES, [0.08, 0.4, 0.72]);
});
