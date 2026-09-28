import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Transport,
  alignOnset,
  applySwing,
  ceilTo,
  removeSwing,
} from "../web/instrument/clock.js";
import { WORLD, chordAt, isChordTone } from "../web/instrument/theory.js";

const close = (actual, expected, epsilon = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `${actual} is not ${expected}`,
  );

test("swing delays only the second sixteenth of each eighth", () => {
  close(applySwing(0, 0.56), 0);
  close(applySwing(0.25, 0.56), 0.28);
  close(applySwing(0.5, 0.56), 0.5);
  close(applySwing(0.75, 0.56), 0.78);
  close(applySwing(0.25, 0.5), 0.25);
});

test("removing swing inverts it everywhere", () => {
  for (let beat = 0; beat < 4; beat += 0.037)
    close(removeSwing(applySwing(beat, 0.62), 0.62), beat, 1e-9);
});

test("ceilTo tolerates floating-point dust at boundaries", () => {
  assert.equal(ceilTo(4 - 1e-12, 4), 4);
  assert.equal(ceilTo(4.001, 4), 8);
  assert.equal(ceilTo(0, 0.5), 0);
});

// At 120 BPM a beat is 0.5 s and a straight sixteenth is 0.125 s.
const transport = new Transport(120, 10);
const align = (eventTime, now, grid = 0.25) =>
  alignOnset({ transport, swing: 0.5, grid, eventTime, now });

test("an early gesture waits for the nearest grid point", () => {
  // Gesture at beat 1.9 rounds to beat 2 (t = 11), which is still ahead.
  close(align(10.95, 10.97), 11);
});

test("a gesture just after its grid point plays at once", () => {
  // Nearest point t = 11 passed 30 ms ago, inside the 50 ms tolerance.
  close(align(11.01, 11.03), 11.035);
});

test("a clearly late gesture lands on the next grid point", () => {
  // Nearest point t = 11 passed 90 ms ago; the next sixteenth is at 11.125.
  close(align(11.02, 11.09), 11.125);
});

test("timing help off plays immediately", () => {
  close(align(11.02, 11.09, 0), 11.095);
});

test("swung grid points are used when aligning", () => {
  const swung = alignOnset({
    transport,
    swing: 0.6,
    grid: 0.25,
    eventTime: 10.13,
    now: 10.1,
  });
  // The second sixteenth of beat 0 sits at 0.3 beats = 0.15 s after the start.
  close(swung, 10.15);
});

test("the ladder is A minor pentatonic across two octaves", () => {
  const classes = new Set(WORLD.ladder.map((pitch) => pitch % 12));
  assert.deepEqual(
    [...classes].sort((a, b) => a - b),
    [0, 2, 4, 7, 9],
  );
  assert.equal(WORLD.ladder.length, 10);
  assert.ok(
    WORLD.ladder.every((pitch, i, all) => i === 0 || pitch > all[i - 1]),
  );
});

test("progressions wrap by bar and voicings contain their chord tones", () => {
  assert.equal(chordAt(WORLD, "low", 0).name, "Am");
  assert.equal(chordAt(WORLD, "low", 5).name, "F");
  assert.equal(chordAt(WORLD, "high", -1).name, "C");
  for (const chords of Object.values(WORLD.progressions))
    for (const chord of chords) {
      assert.ok(isChordTone(chord.bass, chord));
      for (const tone of chord.tones)
        assert.ok(
          chord.pad.some((pitch) => pitch % 12 === tone),
          chord.name,
        );
    }
});
