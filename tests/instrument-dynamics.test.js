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

/**
 * A pinch closing over `frames` camera frames at 30 fps: whether the hand ends pinched,
 * and the strike measured on the frame the pinch caught.
 */
function strikeOver(frames) {
  const tracker = new HandTracker();
  let time = 0;
  let lead = null;
  let strike = null;
  for (let i = 0; i < 10; i++)
    lead = tracker.update([detection()], (time += 1 / 30)).lead;
  for (let i = 1; i <= frames; i++) {
    lead = tracker.update(
      [detection({ closed: i / frames })],
      (time += 1 / 30),
    ).lead;
    strike ??= lead.strike;
  }
  return { pinch: lead.pinch, strike };
}

test("a pinch that closes quickly strikes harder than one that closes slowly", () => {
  const quick = strikeOver(2);
  const slow = strikeOver(8);
  assert.equal(quick.pinch, true);
  assert.equal(slow.pinch, true);
  assert.ok(slow.strike > 0);
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

/** Camera frames at 30 fps, through the tracker and then the controls, as the page runs them. */
function camera() {
  const tracker = new HandTracker();
  const play = { controls: new Controls(), notes: [] };
  let time = 0;
  play.frame = (...detections) => {
    const hands = tracker.update(detections, (time += 1 / 30));
    for (const event of play.controls.update(hands, time))
      if (event.type === "noteOn") play.notes.push(event);
    return hands.lead;
  };
  // A quick pinch from an open hand.
  play.strike = () => {
    for (let i = 0; i < 10; i++) play.frame(detection());
    play.frame(detection({ closed: 0.5 }));
    play.frame(detection({ closed: 1 }));
  };
  return play;
}

test("a strike belongs to the frame its pinch caught, not to the pinch held after it", () => {
  const play = camera();
  play.strike();
  assert.ok(play.notes[0].strike > DYNAMICS.usual);
  assert.equal(play.frame(detection({ closed: 1 })).strike, null);
});

test("a note restarted after a dropout, or pinched as a piece starts, is not struck", () => {
  const play = camera();
  play.strike();
  const [struck] = play.notes;
  assert.ok(struck.velocity > TYPICAL_VELOCITY);
  // Lost for 0.3 s, longer than the lead's grace but within the tracker's memory of the
  // hand, then back still pinched: the note starts again.
  for (let i = 0; i < 9; i++) play.frame();
  play.frame(detection({ closed: 1 }));
  // A new piece, keeping the player's strikes, starts with the hand still pinched.
  play.controls = new Controls({ strikes: play.controls.strikes });
  play.frame(detection({ closed: 1 }));
  const [, restarted, first] = play.notes;
  for (const note of [restarted, first]) {
    assert.equal(note.strike, null);
    assert.equal(note.velocity, TYPICAL_VELOCITY);
  }
  assert.deepEqual(play.controls.strikes, [struck.strike]); // Counted once.
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
  let tick;
  t.mock.method(globalThis, "setInterval", (callback) => {
    tick = callback;
    return 1;
  });
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
    pluck: (time, velocity) => {
      calls.push(["pluck", velocity]);
      return { release() {} };
    },
  };
  const ctx = { currentTime: 0 };
  const engine = new Engine(ctx, synth);
  engine.start(0);
  t.after(() => engine.stop());
  // Run the scheduler up to `seconds`, in its 20 ms ticks.
  const until = (seconds) => {
    while (ctx.currentTime < seconds - 1e-9) {
      ctx.currentTime = Math.min(seconds, ctx.currentTime + 0.02);
      tick();
    }
  };
  return { engine, calls, until };
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

test("a loop replays each note at the velocity it was played", (t) => {
  const { engine, calls, until } = engineWith(t);
  until(1);
  engine.noteOn(0, performance.now() / 1000); // A typical strike.
  until(1.3);
  engine.noteOff();
  engine.noteOn(2, performance.now() / 1000, 1);
  until(1.6);
  engine.noteOff();
  engine.capture();
  until(12); // One cycle later, both notes play again.
  const plucks = calls.filter(([kind]) => kind === "pluck");
  // A typical strike loops at 0.72, the level of every loop note before strikes.
  assert.deepEqual(
    plucks.map(([, velocity]) => velocity),
    [0.72, 1],
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
