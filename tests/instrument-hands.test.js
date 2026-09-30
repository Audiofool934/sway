import { test } from "node:test";
import assert from "node:assert/strict";
import { HandTracker, OneEuro, handShape } from "../web/instrument/hands.js";
import {
  Controls,
  TIMING,
  stepWithHysteresis,
} from "../web/instrument/controls.js";

// A simple metric hand: wrist at the origin, fingers pointing up (+y).
const MCP = {
  5: [0.025, 0.085],
  9: [0.005, 0.088],
  13: [-0.015, 0.083],
  17: [-0.033, 0.075],
};
const LENGTH = { 5: 0.07, 9: 0.08, 13: 0.075, 17: 0.06 };

function worldHand(shape) {
  const points = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  points[1] = { x: 0.02, y: 0.02, z: 0 };
  points[2] = { x: 0.035, y: 0.04, z: 0 };
  points[3] = { x: 0.045, y: 0.06, z: 0 };
  points[4] = { x: 0.06, y: 0.08, z: 0 };
  for (const base of [5, 9, 13, 17]) {
    const [x, y] = MCP[base];
    points[base] = { x, y, z: 0 };
    const curled = shape === "fist" || (shape === "pinch-curled" && base !== 5);
    const tip = curled
      ? { x, y: y - 0.035, z: 0.025 }
      : { x, y: y + LENGTH[base], z: 0 };
    for (let i = 1; i <= 3; i++)
      points[base + i] = {
        x: x + ((tip.x - x) * i) / 3,
        y: y + ((tip.y - y) * i) / 3,
        z: (tip.z * i) / 3,
      };
  }
  if (shape === "pinch" || shape === "pinch-curled") {
    points[8] = { x: 0.042, y: 0.11, z: 0.035 };
    points[4] = { x: 0.04, y: 0.105, z: 0.03 };
  }
  if (shape === "fist") points[4] = { x: 0.02, y: 0.06, z: 0.035 };
  return points;
}

// A small hand centred at (x, y) in the unmirrored camera frame.
function hand({
  shape = "open",
  x = 0.5,
  y = 0.5,
  side = "Right",
  score = 0.95,
}) {
  const world = worldHand(shape);
  const points = world.map((p) => ({ x: x - p.x, y: y - p.y, z: p.z }));
  return { side, score, points, world };
}

test("hand shapes separate open, pinch, and fist", () => {
  const open = handShape(worldHand("open"));
  const pinch = handShape(worldHand("pinch"));
  const curledPinch = handShape(worldHand("pinch-curled"));
  const fist = handShape(worldHand("fist"));
  assert.ok(open.pinch > 0.42 && open.curl > 1.4, JSON.stringify(open));
  assert.ok(pinch.pinch < 0.3 && pinch.curl > 1.4, JSON.stringify(pinch));
  assert.ok(curledPinch.pinch < 0.3 && curledPinch.indexCurl > 1.15);
  assert.ok(fist.curl < 1.2 && fist.indexCurl < 1.15, JSON.stringify(fist));
});

test("the tracker reports pinch and fist, never both", () => {
  const tracker = new HandTracker();
  const shapes = ["open", "pinch", "pinch-curled", "fist"];
  const seen = shapes.map(
    (shape, i) => tracker.update([hand({ shape })], i / 30).lead,
  );
  assert.deepEqual(
    seen.map(({ pinch, fist }) => [pinch, fist]),
    [
      [false, false],
      [true, false],
      [true, false],
      [false, true],
    ],
  );
});

test("rendered landmarks mirror the camera once and keep all 21 measured joints", () => {
  const tracker = new HandTracker({ aspect: 16 / 9 });
  const raw = hand({ x: 0.3 });
  const original = structuredClone(raw);
  const { lead } = tracker.update([raw], 0);
  assert.equal(lead.landmarks.length, 21);
  for (let i = 0; i < 21; i++) {
    assert.ok(Math.abs(lead.landmarks[i].x - (1 - raw.points[i].x)) < 1e-12);
    assert.ok(Math.abs(lead.landmarks[i].y - raw.points[i].y) < 1e-12);
    assert.ok(Math.abs(lead.landmarks[i].z - raw.points[i].z) < 1e-12);
  }
  assert.deepEqual(
    raw,
    original,
    "rendering must not mutate the detector result",
  );
});

test("the smoothed skeleton stays centred on the musical cursor during movement and a dropout", () => {
  const tracker = new HandTracker();
  let id;
  for (let i = 0; i < 50; i++) {
    if (i > 20 && i < 28) {
      assert.deepEqual(tracker.update([], i / 30), {});
      continue;
    }
    const { lead } = tracker.update(
      [
        hand({
          x: 0.3 + i * 0.003,
          y: 0.5 + i * 0.003,
          shape: i > 30 ? "pinch" : "open",
        }),
      ],
      i / 30,
    );
    id ??= lead.id;
    assert.equal(lead.id, id);
    const palm = [0, 5, 9, 13, 17].reduce(
      (centre, joint) => ({
        x: centre.x + lead.landmarks[joint].x / 5,
        y: centre.y + lead.landmarks[joint].y / 5,
      }),
      { x: 0, y: 0 },
    );
    assert.ok(Math.abs(palm.x - lead.x) < 1e-12);
    assert.ok(Math.abs(palm.y - lead.y) < 1e-12);
  }
});

test("the performer's right hand leads and roles survive a label flicker", () => {
  const tracker = new HandTracker();
  // Tasks HandLandmarker labels the unmirrored camera input anatomically.
  // The performer's right hand appears on the left of that raw frame.
  const frame = (rightLabel, t) =>
    tracker.update(
      [
        hand({ side: rightLabel, x: 0.3, y: 0.5 }),
        hand({ side: "Left", x: 0.7, y: 0.5, score: 0.9 }),
      ],
      t,
    );
  let roles;
  for (let i = 0; i < 20; i++) roles = frame("Right", i / 30);
  assert.ok(roles.lead.x > 0.6 && roles.band.x < 0.4);
  // Both hands briefly labelled "Left": the established roles hold.
  for (let i = 20; i < 23; i++) roles = frame("Left", i / 30);
  assert.ok(roles.lead.x > 0.6 && roles.band.x < 0.4);
});

test("left-handed players lead with the left hand", () => {
  const tracker = new HandTracker({ leadSide: "Left" });
  let roles;
  for (let i = 0; i < 10; i++)
    roles = tracker.update(
      [hand({ side: "Right", x: 0.3 }), hand({ side: "Left", x: 0.7 })],
      i / 30,
    );
  assert.ok(roles.lead.x < 0.4 && roles.band.x > 0.6);
});

test("a lone hand keeps its anatomical role on either side of the screen", () => {
  for (const leadSide of ["Right", "Left"])
    for (const side of ["Right", "Left"])
      for (const x of [0.25, 0.75]) {
        const tracker = new HandTracker({ leadSide });
        let roles;
        for (let i = 0; i < 30; i++)
          roles = tracker.update([hand({ side, x })], i / 30);
        const role = side === leadSide ? "lead" : "band";
        assert.equal(
          roles[role]?.side,
          side,
          `${leadSide} lead, ${side} at ${x}`,
        );
        assert.equal(Object.keys(roles).length, 1);
      }
});

test("the selected lead hand plays notes and the other hand captures loops", () => {
  for (const leadSide of ["Right", "Left"])
    for (const pinchingSide of ["Right", "Left"]) {
      const tracker = new HandTracker({ leadSide });
      const controls = new Controls();
      const events = [];
      for (let i = 0; i < 60; i++) {
        const time = i / 30;
        const hands = ["Right", "Left"].map((side) =>
          hand({
            side,
            x: side === "Right" ? 0.3 : 0.7,
            shape: i >= 20 && side === pinchingSide ? "pinch" : "open",
          }),
        );
        events.push(...controls.update(tracker.update(hands, time), time));
      }
      const playsLead = pinchingSide === leadSide;
      assert.equal(
        events.filter((e) => e.type === "noteOn").length,
        playsLead ? 1 : 0,
      );
      assert.equal(
        events.filter((e) => e.type === "capture").length,
        playsLead ? 0 : 1,
      );
    }
});

test("the one-euro filter settles on a steady value", () => {
  const filter = new OneEuro();
  let value;
  for (let i = 0; i < 60; i++) value = filter.filter(i === 0 ? 0 : 1, i / 30);
  assert.ok(Math.abs(value - 1) < 1e-3);
});

test("steps change only after crossing the hysteresis margin", () => {
  assert.equal(stepWithHysteresis(0.35, 10, null, 0.2), 3);
  assert.equal(stepWithHysteresis(0.415, 10, 3, 0.2), 3);
  assert.equal(stepWithHysteresis(0.43, 10, 3, 0.2), 4);
  assert.equal(stepWithHysteresis(0.285, 10, 3, 0.2), 3);
  assert.equal(stepWithHysteresis(0.27, 10, 3, 0.2), 2);
  assert.equal(stepWithHysteresis(1, 10, null, 0.2), 9);
});

// Controls take per-role features directly, as every input source provides them.
const heightY = (height, range = { top: 0.14, bottom: 0.86 }) =>
  range.bottom - height * (range.bottom - range.top);
const lead = (height, pinch = false, fist = false) => ({
  y: heightY(height),
  pinch,
  fist,
});
const band = (height, { pinch = false, fist = false } = {}) => ({
  y: heightY(height),
  pinch,
  fist,
});
const types = (events) => events.map((e) => e.type);

test("a pinch plays, moving draws legato, and releasing ends the note", () => {
  const controls = new Controls();
  assert.deepEqual(controls.update({ lead: lead(0.25) }, 0), []);
  const on = controls.update({ lead: lead(0.25, true) }, 0.1);
  assert.deepEqual(on, [{ type: "noteOn", rung: 2, time: 0.1 }]);
  assert.deepEqual(controls.update({ lead: lead(0.26, true) }, 0.13), []);
  const moved = controls.update({ lead: lead(0.45, true) }, 0.2);
  assert.deepEqual(moved, [{ type: "noteMove", rung: 4, time: 0.2 }]);
  assert.deepEqual(types(controls.update({ lead: lead(0.45) }, 0.3)), [
    "noteOff",
  ]);
});

test("a lost lead hand releases its note after a short grace", () => {
  const controls = new Controls();
  controls.update({ lead: lead(0.5, true) }, 0);
  assert.deepEqual(controls.update({}, 0.1), []);
  assert.deepEqual(controls.update({}, 0.2), [{ type: "noteOff", time: 0 }]);
});

test("band height sets energy once it settles", () => {
  const controls = new Controls();
  assert.deepEqual(controls.update({ band: band(0.5) }, 0), []);
  assert.deepEqual(
    controls.update({ band: band(0.5) }, TIMING.levelSettle + 0.01),
    [{ type: "energy", level: 2, time: TIMING.levelSettle + 0.01 }],
  );
  // A brief swing through another level does not count.
  assert.deepEqual(controls.update({ band: band(0.9) }, 0.3), []);
  assert.deepEqual(controls.update({ band: band(0.5) }, 0.35), []);
  assert.deepEqual(controls.update({ band: band(0.5) }, 0.6), []);
});

test("a held fist cuts the band and an open hand brings it back", () => {
  const controls = new Controls();
  controls.update({ band: band(0.5) }, 0);
  controls.update({ band: band(0.5) }, 0.2);
  assert.deepEqual(controls.update({ band: band(0.5, { fist: true }) }, 1), []);
  assert.deepEqual(controls.update({ band: band(0.5, { fist: true }) }, 1.12), [
    { type: "cut", on: true, time: 1 },
  ]);
  assert.deepEqual(controls.update({ band: band(0.5) }, 2), []);
  assert.deepEqual(controls.update({ band: band(0.5) }, 2.12), [
    { type: "cut", on: false, time: 2 },
  ]);
});

test("a held band-hand pinch captures once, and brief pinches do not", () => {
  const controls = new Controls();
  controls.update({ band: band(0.5) }, 0);
  controls.update({ band: band(0.5) }, 0.2);
  const run = (from, to, features) => {
    const events = [];
    for (let t = from; t <= to + 1e-9; t += 0.05)
      events.push(...controls.update({ band: features }, t));
    return types(events);
  };
  // Finger movement can look like a pinch for half a second: no capture.
  assert.ok(!run(1, 1.5, band(0.5, { pinch: true })).includes("capture"));
  run(1.55, 1.6, band(0.5));
  // A deliberate hold captures exactly once, even if it continues.
  const held = run(2, 3.5, band(0.5, { pinch: true }));
  assert.equal(held.filter((type) => type === "capture").length, 1);
  assert.equal(controls.captureProgress, 0);
  // Opening a fist passes through a pinch: that is not a capture either.
  run(4, 4.3, band(0.5, { fist: true }));
  assert.ok(!run(4.35, 4.6, band(0.5, { pinch: true })).includes("capture"));
});

test("energy ignores height while the band hand makes a shape", () => {
  const controls = new Controls();
  controls.update({ band: band(0.5) }, 0);
  controls.update({ band: band(0.5) }, 0.2);
  const during = [];
  for (let t = 1; t < 1.5; t += 0.05)
    during.push(...controls.update({ band: band(0.95, { pinch: true }) }, t));
  assert.ok(!types(during).includes("energy"));
});

test("two fists held together end the piece once", () => {
  const controls = new Controls();
  const both = {
    lead: lead(0.5, false, true),
    band: band(0.5, { fist: true }),
  };
  const events = [];
  for (let t = 0; t <= 1.2; t += 0.05) events.push(...controls.update(both, t));
  assert.equal(types(events).filter((type) => type === "end").length, 1);
});

test("a lost band hand keeps energy but releases a cut", () => {
  const controls = new Controls();
  controls.update({ band: band(0.9) }, 0);
  controls.update({ band: band(0.9) }, 0.2);
  controls.update({ band: band(0.9, { fist: true }) }, 0.5);
  controls.update({ band: band(0.9, { fist: true }) }, 0.7);
  assert.equal(controls.band.cut, true);
  assert.deepEqual(controls.update({}, 1.2), []);
  assert.deepEqual(types(controls.update({}, 1.8)), ["cut"]);
  assert.equal(controls.band.level, 4);
});
