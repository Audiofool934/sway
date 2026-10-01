// The lead's dynamics: how quickly a pinch closes sets a note's velocity, and leaning
// toward the camera while holding swells it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Controls, DYNAMICS } from "../web/instrument/controls.js";
import { Engine } from "../web/instrument/engine.js";
import { HandTracker, closeness } from "../web/instrument/hands.js";
import { Synth } from "../web/instrument/synth.js";
import { TYPICAL_VELOCITY } from "../web/instrument/theory.js";

// A metric hand, wrist at the origin and fingers up (+y). `closed` moves the thumb and
// index tips from an open hand (0) to touching (1).
function worldHand(closed = 0) {
  const points = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  const mcps = {
    5: [0.025, 0.085],
    9: [0.005, 0.088],
    13: [-0.015, 0.083],
    17: [-0.033, 0.075],
  };
  for (const [base, [x, y]] of Object.entries(mcps)) {
    for (let i = 0; i <= 3; i++)
      points[Number(base) + i] = { x, y: y + 0.022 * i, z: 0 };
  }
  const mix = (a, b) => a + (b - a) * closed;
  points[4] = { x: mix(0.06, 0.04), y: mix(0.08, 0.105), z: mix(0, 0.03) };
  points[8] = { x: mix(0.025, 0.042), y: mix(0.151, 0.11), z: mix(0, 0.035) };
  return points;
}

/**
 * A detection: the camera sees the metric hand `scale` times its size in screen heights,
 * centred, in a 4:3 frame. `tilt` turns the hand about the vertical, foreshortening its
 * width alike on screen and in the metric landmarks.
 */
function detection({ closed = 0, scale = 2, tilt = 0 } = {}) {
  const world = worldHand(closed).map((p) => ({
    x: p.x * Math.cos(tilt),
    y: p.y,
    z: p.z + p.x * Math.sin(tilt),
  }));
  const aspect = 4 / 3;
  const points = world.map((p) => ({
    x: 0.5 - (scale * p.x) / aspect,
    y: 0.6 - scale * p.y,
    z: 0,
  }));
  return { side: "Right", score: 0.95, points, world };
}

/** The lead's features after a pinch closes over `frames` camera frames at 30 fps. */
function strikeOver(frames) {
  const tracker = new HandTracker();
  let time = 0;
  let lead = null;
  for (let i = 0; i < 10; i++)
    lead = tracker.update([detection()], (time += 1 / 30)).lead;
  for (let i = 1; i <= frames; i++)
    lead = tracker.update(
      [detection({ closed: i / frames })],
      (time += 1 / 30),
    ).lead;
  return lead;
}

test("a pinch that closes quickly strikes harder than one that closes slowly", () => {
  const quick = strikeOver(2);
  const slow = strikeOver(8);
  assert.equal(quick.pinch, true);
  assert.equal(slow.pinch, true);
  assert.ok(
    quick.strike > 2.5 * slow.strike,
    `${quick.strike} vs ${slow.strike}`,
  );
});

test("closeness follows distance from the camera, not the hand's tilt", () => {
  const near = detection({ scale: 3 });
  const far = detection({ scale: 2 });
  const tilted = detection({ scale: 2, tilt: 0.7 });
  const toScreen = (d) =>
    d.points.map((p) => ({ x: (1 - p.x) * (4 / 3), y: p.y }));
  const of = (d) => closeness(toScreen(d), d.world);
  assert.ok(Math.abs(of(near) / of(far) - 1.5) < 1e-9);
  assert.ok(Math.abs(of(tilted) / of(far) - 1) < 1e-9);
  assert.equal(closeness(toScreen(far), undefined), null);
});

const pinched = (strike, closenessValue = null) => ({
  y: 0.5,
  pinch: true,
  fist: false,
  strike,
  closeness: closenessValue,
});
const open = { y: 0.5, pinch: false, fist: false };

/** The velocity of each pinch with these strikes, one after another. */
function velocities(strikes, options) {
  const controls = new Controls(options);
  let time = 0;
  return strikes.map((strike) => {
    controls.update({ lead: open }, (time += 0.2));
    const [on] = controls.update({ lead: pinched(strike) }, (time += 0.2));
    return on.velocity;
  });
}

test("a strike's velocity is set by how it compares with the usual strike", () => {
  const usual = DYNAMICS.usual;
  const [same, twice, half, crawl, slam] = velocities([
    usual,
    2 * usual,
    usual / 2,
    usual / 1000,
    usual * 1000,
  ]);
  assert.equal(same, TYPICAL_VELOCITY);
  assert.equal(twice, +(TYPICAL_VELOCITY + DYNAMICS.spread).toFixed(3));
  assert.equal(half, +(TYPICAL_VELOCITY - DYNAMICS.spread).toFixed(3));
  assert.equal(crawl, DYNAMICS.floor);
  assert.equal(slam, 1);
});

test("the usual strike becomes the player's own after a few, and carries over", () => {
  const quick = 4 * DYNAMICS.usual;
  const played = velocities(Array(DYNAMICS.settle + 1).fill(quick));
  assert.equal(played[0], 1); // Four times the starting guess.
  assert.equal(played.at(-1), TYPICAL_VELOCITY); // Now usual for this player.
  // The next piece starts with the strikes the last one heard.
  const strikes = Array(DYNAMICS.settle).fill(quick);
  assert.deepEqual(velocities([quick], { strikes }), [TYPICAL_VELOCITY]);
});

test("without a measured strike a note plays at the typical velocity", () => {
  assert.deepEqual(velocities([null, 0]), [TYPICAL_VELOCITY, TYPICAL_VELOCITY]);
});

test("leaning in swells a held note, leaning back softens it, and drift is ignored", () => {
  const controls = new Controls();
  const at = (value, time) =>
    controls
      .update({ lead: pinched(DYNAMICS.usual, value) }, time)
      .filter((event) => event.type === "swell")
      .map((event) => event.value);
  controls.update({ lead: open }, 0);
  assert.deepEqual(at(2, 0.1), []); // The onset sets where the hand started.
  assert.deepEqual(at(2 * 1.02, 0.2), []); // A steady hand drifts this much.
  assert.deepEqual(at(2 * DYNAMICS.swellRange, 0.3), [1]);
  assert.deepEqual(at(2 * DYNAMICS.swellRange * 1.2, 0.4), []); // Already full.
  assert.deepEqual(at(2, 0.5), [0]);
  assert.deepEqual(at(2 / DYNAMICS.swellRange, 0.6), [-1]);
  const halfway = Math.sqrt(DYNAMICS.swellRange);
  const [value] = at(2 * halfway, 0.7);
  const expected =
    (0.5 - DYNAMICS.swellDeadzone) / (1 - DYNAMICS.swellDeadzone);
  assert.ok(Math.abs(value - expected) < 0.001);
  // A new note starts from where the hand is then.
  controls.update({ lead: open }, 0.8);
  assert.deepEqual(at(3, 0.9), []);
  assert.deepEqual(at(3 * DYNAMICS.swellRange, 1), [1]);
});

test("a mouse, with no closeness, never swells", () => {
  const controls = new Controls();
  controls.update({ lead: open }, 0);
  const events = [0.1, 0.2, 0.3].flatMap((time) =>
    controls.update({ lead: pinched(null) }, time),
  );
  assert.deepEqual(
    events.map((event) => event.type),
    ["noteOn"],
  );
});

function engineWith(t) {
  t.mock.method(globalThis, "setInterval", () => 1);
  t.mock.method(globalThis, "clearInterval", () => {});
  const calls = [];
  const synth = {
    setTempo() {},
    play: () => null,
    leadOn: (time, pitch, velocity) => {
      calls.push(["on", pitch, velocity]);
      return { velocity };
    },
    leadMove: (voice, time, pitch) => calls.push(["move", pitch]),
    leadSwell: (voice, time, value) => calls.push(["swell", value]),
    leadOff: (voice) => calls.push(["off", voice.velocity]),
  };
  const engine = new Engine({ currentTime: 0 }, synth);
  engine.start(0);
  t.after(() => engine.stop());
  return { engine, calls };
}

test("the engine plays, logs, and loops each note at its velocity", (t) => {
  const { engine, calls } = engineWith(t);
  const notes = [];
  engine.on((event) => event.type === "note" && notes.push(event));
  const now = performance.now() / 1000;
  engine.noteOn(2, now, 0.9);
  engine.noteMove(4, now);
  assert.deepEqual(calls.slice(0, 2), [
    ["on", engine.world.ladder[2], 0.9],
    ["move", engine.world.ladder[4]],
  ]);
  const lead = engine.log.filter((note) => note.part === "lead");
  assert.deepEqual(
    lead.map((note) => note.velocity),
    [0.9, 0.738], // A joined note is not struck again, so it is logged softer.
  );
  assert.deepEqual(
    engine.looper.history.map((note) => note.velocity),
    [0.9, 0.738],
  );
  assert.deepEqual(
    notes.map((note) => note.velocity),
    [0.9, 0.9],
  );
});

test("a swell reaches the sounding note, and nothing when no note sounds", (t) => {
  const { engine, calls } = engineWith(t);
  engine.swell(0.5);
  assert.deepEqual(calls, []);
  engine.noteOn(0, performance.now() / 1000);
  engine.swell(0.5);
  assert.deepEqual(calls.at(-1), ["swell", 0.5]);
  assert.equal(engine.lead.swell, 0.5);
  engine.noteOff();
  engine.swell(1);
  assert.notDeepEqual(calls.at(-1), ["swell", 1]);
});

// A stand-in for an AudioContext that records what is scheduled on each parameter.
class FakeParam {
  constructor() {
    this.value = 0;
    this.events = [];
  }
  setValueAtTime(value, time) {
    this.events.push(["set", value, time]);
  }
  linearRampToValueAtTime(value, time) {
    this.events.push(["ramp", value, time]);
  }
  exponentialRampToValueAtTime(value, time) {
    this.events.push(["ramp", value, time]);
  }
  setTargetAtTime(value, time) {
    this.events.push(["target", value, time]);
  }
  cancelScheduledValues() {}
  cancelAndHoldAtTime() {}
}

function fakeContext() {
  const node = (...params) => {
    const made = {
      connect: (to) => to,
      disconnect() {},
      start() {},
      stop() {},
    };
    for (const name of params) made[name] = new FakeParam();
    return made;
  };
  return {
    sampleRate: 8000,
    currentTime: 0,
    destination: node(),
    createGain: () => node("gain"),
    createOscillator: () => node("frequency", "detune"),
    createBiquadFilter: () => node("frequency", "Q", "detune"),
    createDynamicsCompressor: () =>
      node("threshold", "knee", "ratio", "attack", "release"),
    createWaveShaper: () => node(),
    createConvolver: () => node(),
    createDelay: () => node("delayTime"),
    createStereoPanner: () => node("pan"),
    createBufferSource: () => node("playbackRate"),
    createBuffer: (channels, length, rate) => ({
      duration: length / rate,
      getChannelData: () => new Float32Array(length),
    }),
  };
}

const peak = (voice) =>
  voice.amp.gain.events.find(([kind]) => kind === "ramp")[1];
const settled = (voice) => voice.filter.frequency.events[1][1];

test("a harder strike plays the lead louder and brighter", () => {
  const synth = new Synth(fakeContext());
  const soft = synth.leadOn(0, 69, 0.4);
  const typical = synth.leadOn(0, 69);
  const hard = synth.leadOn(0, 69, 1);
  assert.equal(peak(typical), 0.85); // The level the mix was balanced at.
  assert.ok(peak(hard) > 2 * peak(soft));
  assert.ok(
    settled(hard) > settled(typical) && settled(typical) > settled(soft),
  );
});

test("a swell raises a held note's level and brightness, and stops at release", () => {
  const synth = new Synth(fakeContext());
  const voice = synth.leadOn(0, 69);
  synth.leadSwell(voice, 1, 1);
  synth.leadSwell(voice, 2, -1);
  const levels = voice.swell.gain.events.map(([, value]) => value);
  const detunes = voice.filter.detune.events.map(([, value]) => value);
  assert.ok(Math.abs(levels[0] - 2 ** 0.85) < 1e-9); // About 5 dB louder.
  assert.ok(Math.abs(levels[1] - 2 ** -0.85) < 1e-9);
  assert.deepEqual(detunes, [900, -900]);
  synth.leadOff(voice, 3);
  synth.leadSwell(voice, 4, 1);
  assert.equal(voice.swell.gain.events.length, 2);
});
