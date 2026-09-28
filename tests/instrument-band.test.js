import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STEPS_PER_BAR,
  bandEnding,
  bandStep,
  progressionFor,
} from "../web/instrument/band.js";
import { Looper, MAX_LAYERS } from "../web/instrument/looper.js";
import { WORLD, chordAt } from "../web/instrument/theory.js";

const bar = (
  level,
  { barIndex = 0, progression = "low", rising = null } = {},
) =>
  Array.from({ length: STEPS_PER_BAR }, (_, step) =>
    bandStep({ world: WORLD, bar: barIndex, step, level, progression, rising }),
  ).flat();
const parts = (events) => new Set(events.map((e) => e.part));
const DRUMS = [
  "kick",
  "snare",
  "clap",
  "hat",
  "openhat",
  "shaker",
  "riser",
  "crash",
];

test("each energy level adds layers in the documented order", () => {
  assert.deepEqual([...parts(bar(0))], ["pad"]);
  const pulse = parts(bar(1));
  for (const part of ["kick", "shaker", "bass", "pad"])
    assert.ok(pulse.has(part), part);
  assert.ok(!pulse.has("snare"));
  const groove = parts(bar(2));
  for (const part of ["snare", "hat", "keys"])
    assert.ok(groove.has(part), part);
  assert.ok(parts(bar(3)).has("openhat"));
  const peak = parts(bar(4));
  for (const part of ["clap", "arp"]) assert.ok(peak.has(part), part);
});

test("every pitched band note belongs to the bar's chord or the key", () => {
  const key = new Set(WORLD.ladder.map((p) => p % 12).concat([5, 11])); // A natural minor.
  for (const progression of ["low", "high"])
    for (let level = 0; level <= 4; level++)
      for (let barIndex = 0; barIndex < 8; barIndex++) {
        const chord = chordAt(WORLD, progression, barIndex);
        const next = chordAt(WORLD, progression, barIndex + 1);
        for (const event of bar(level, { barIndex, progression })) {
          for (const pitch of event.pitches ?? [])
            assert.ok(chord.pad.includes(pitch));
          if (event.part === "bass") {
            const allowed = [
              chord.bass,
              chord.bass + 7,
              chord.bass + 12,
              next.bass,
            ];
            assert.ok(
              allowed.includes(event.pitch),
              `${event.pitch} over ${chord.name}`,
            );
          }
          if (event.pitch !== undefined) assert.ok(key.has(event.pitch % 12));
        }
      }
});

test("drums always sit on the sixteenth grid with sane velocities", () => {
  for (let level = 0; level <= 4; level++)
    for (const event of bar(level, { barIndex: 3 })) {
      assert.ok(
        Number.isInteger(event.step) && event.step >= 0 && event.step < 16,
      );
      assert.ok(
        event.velocity > 0 && event.velocity <= 1,
        `${event.part} ${event.velocity}`,
      );
    }
});

test("rising energy fills the last beat with a snare roll", () => {
  const fill = bar(2, { rising: 4 }).filter((e) => e.step >= 12);
  const snares = fill.filter((e) => e.part === "snare").map((e) => e.step);
  assert.deepEqual(snares, [12, 13, 14, 15]);
  assert.ok(!fill.some((e) => e.part === "hat" || e.part === "openhat"));
});

test("rising from a quiet level adds a riser before the downbeat", () => {
  const risers = bar(1, { rising: 3 }).filter((e) => e.part === "riser");
  assert.equal(risers.length, 1);
  assert.equal(risers[0].step, 8);
});

test("the band varies deterministically", () => {
  assert.deepEqual(bar(3, { barIndex: 7 }), bar(3, { barIndex: 7 }));
});

test("the progression brightens at high energy", () => {
  assert.equal(progressionFor(2), "low");
  assert.equal(progressionFor(3), "high");
});

test("the ending resolves everything to the tonic", () => {
  const ending = bandEnding(WORLD);
  assert.ok(ending.every((e) => e.step === 0));
  assert.equal(ending.find((e) => e.part === "bass").pitch % 12, 9);
  assert.deepEqual(
    ending.find((e) => e.part === "pad").pitches,
    WORLD.tonic.pad,
  );
  assert.ok(
    !ending.some(
      (e) => DRUMS.includes(e.part) && !["kick", "crash"].includes(e.part),
    ),
  );
});

test("capturing turns the last cycle into a layer that continues seamlessly", () => {
  const looper = new Looper(16);
  looper.noteOn(60, 3.9); // Before the captured cycle.
  looper.noteOn(64, 5);
  looper.noteOff(6);
  looper.noteOn(67, 12.25);
  looper.noteOn(69, 19.5); // Still held when captured.
  const layer = looper.capture(20);
  assert.deepEqual(
    layer.notes.map(({ pitch, position, beats }) => [pitch, position, beats]),
    [
      [64, 5, 1],
      [67, 12.25, 7.25],
      [69, 3.5, 0.5],
    ],
  );
  // Replays start after the capture, each exactly one cycle after it was played.
  const replay = looper.window(20, 40).map(({ pitch, beat }) => [pitch, beat]);
  assert.deepEqual(replay, [
    [64, 21],
    [67, 28.25],
    [69, 35.5],
    [64, 37],
  ]);
});

test("an empty capture adds nothing, and layers are bounded", () => {
  const looper = new Looper(16);
  assert.equal(looper.capture(32), null);
  for (let i = 0; i < MAX_LAYERS + 2; i++) {
    looper.noteOn(60 + i, 40 + i * 16);
    looper.noteOff(40.5 + i * 16);
    looper.capture(41 + i * 16);
  }
  assert.equal(looper.layers.length, MAX_LAYERS);
  assert.equal(looper.undo().notes[0].pitch, 60 + MAX_LAYERS + 1);
  assert.equal(looper.layers.length, MAX_LAYERS - 1);
});
