// Part comparisons and the live composer switch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanPlan } from "../web/instrument/arrange.js";
import { Engine } from "../web/instrument/engine.js";
import { Mixer, PARTS } from "../web/instrument/listening.js";
import { CHORDS, WORLD } from "../web/instrument/theory.js";

const BAR = (WORLD.beatsPerBar * 60) / WORLD.tempo;

// An AudioParam that remembers the value it is heading for.
const param = (value) => ({
  value,
  cancelScheduledValues() {},
  setTargetAtTime(target) {
    this.value = target;
  },
});

function fakeSynth() {
  const names = PARTS.flatMap((part) => part.buses);
  return {
    ctx: { currentTime: 0 },
    buses: Object.fromEntries(names.map((name) => [name, { gain: param(1) }])),
    levels: Object.fromEntries(names.map((name, i) => [name, 0.1 * (i + 1)])),
    shadows: { pad: { gain: param(0) }, answer: { gain: param(0) } },
    duck: { gain: param(0.65) },
    ducking: true,
  };
}

const gains = (synth) =>
  Object.fromEntries(
    Object.entries(synth.buses).map(([name, bus]) => [name, bus.gain.value]),
  );

test("MRT2 alone mutes every other part and stops the ducking", () => {
  const synth = fakeSynth();
  const mixer = new Mixer(synth);
  mixer.preset("mrt2");
  for (const [name, gain] of Object.entries(gains(synth)))
    assert.equal(
      gain,
      ["harmony", "lead"].includes(name) ? synth.levels[name] : 0,
      name,
    );
  assert.equal(synth.shadows.pad.gain.value, 0);
  assert.equal(synth.ducking, false);
  assert.equal(synth.duck.gain.value, 1);
  assert.equal(mixer.current, "mrt2");
});

test("returning to the full mix restores every bus and silences stand-ins", () => {
  const synth = fakeSynth();
  const mixer = new Mixer(synth);
  mixer.preset("qwen");
  mixer.preset("everything");
  for (const [name, gain] of Object.entries(gains(synth)))
    assert.equal(gain, synth.levels[name], name);
  assert.equal(synth.shadows.pad.gain.value, 0);
  assert.equal(synth.shadows.answer.gain.value, 0);
  assert.equal(synth.ducking, true);
});

test("muting MRT2 brings in the synthesized pad and answer line on its bars", () => {
  const synth = fakeSynth();
  const mixer = new Mixer(synth);
  mixer.preset("qwen");
  assert.equal(synth.buses.harmony.gain.value, 0);
  assert.equal(synth.buses.pad.gain.value, synth.levels.pad);
  assert.equal(synth.shadows.pad.gain.value, 1);
  assert.equal(synth.shadows.answer.gain.value, 1);
  mixer.set("harmony", true);
  assert.equal(synth.shadows.pad.gain.value, 0);
  assert.equal(mixer.current, null);
  // Every drum bus follows the one switch, and so does the ducking.
  mixer.preset("everything");
  mixer.set("drums", false);
  for (const name of ["kick", "snare", "hat", "crash"])
    assert.equal(synth.buses[name].gain.value, 0);
  assert.equal(synth.ducking, false);
  mixer.set("drums", true);
  assert.equal(synth.buses.kick.gain.value, synth.levels.kick);
  assert.equal(mixer.current, "everything");
});

class FakeComposer {
  constructor() {
    this.requests = [];
    this.plans = new Map();
  }
  request(cycle) {
    this.requests.push(cycle);
  }
  take(cycle) {
    return this.plans.get(cycle) ?? null;
  }
  stop() {}
}

function band(t) {
  let tick;
  t.mock.method(globalThis, "setInterval", (callback) => {
    tick = callback;
    return 1;
  });
  t.mock.method(globalThis, "clearInterval", () => {});
  const ctx = { currentTime: 0 };
  const synth = { setTempo() {}, play: () => null };
  const composer = new FakeComposer();
  const engine = new Engine(ctx, synth, { composer });
  engine.start(0);
  t.after(() => engine.stop());
  const until = (seconds) => {
    while (ctx.currentTime < seconds - 1e-9) {
      ctx.currentTime = Math.min(seconds, ctx.currentTime + 0.02);
      tick();
    }
  };
  return { engine, composer, until };
}

const plan = cleanPlan(
  { chords: ["Dm", "Am", "F", "Em"], texture: "hold", answer: [], caption: "" },
  { world: WORLD, chords: CHORDS },
);

test("with Qwen switched off, the band ignores its plans and stops asking", (t) => {
  const { engine, composer, until } = band(t);
  assert.deepEqual(composer.requests, [1]);
  engine.setComposing(false);
  composer.plans.set(1, plan);
  until(4 * BAR + 0.1);
  assert.equal(engine.barInfo(4).composed, false);
  assert.deepEqual(composer.requests, [1]); // Not asked for cycle 2.
});

test("switched back on, Qwen is asked at once for the first open cycle", (t) => {
  const { engine, composer, until } = band(t);
  engine.setComposing(false);
  until(0.5 * BAR);
  engine.setComposing(true); // Cycle 1 settles at bar 2, so it is still open.
  assert.deepEqual(composer.requests, [1, 1]);
  until(2.5 * BAR);
  engine.setComposing(false);
  engine.setComposing(true); // Now cycle 1 is settled: ask for cycle 2.
  assert.equal(composer.requests.at(-1), 2);
});
