import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Judge,
  LESSONS,
  calibrate,
  passed,
} from "../web/instrument/tutorial.js";
import { WORLD } from "../web/instrument/theory.js";

const beatSeconds = 60 / WORLD.tempo; // 0.6 s: one beat is 600 ms.
const lesson = (id) => LESSONS.find((l) => l.id === id);

test("every lesson chart fits its bars and the ladder", () => {
  for (const { targets, bars, level } of LESSONS) {
    assert.ok(level >= 0 && level < WORLD.levels.length);
    for (const target of targets) {
      assert.ok(
        target.beat >= 0 && target.beat < bars * 4,
        `${target.kind} ${target.beat}`,
      );
      if (target.kind === "note")
        assert.ok(target.rung >= 0 && target.rung < WORLD.ladder.length);
    }
    const notes = targets.filter((t) => t.kind === "note");
    // Notes never overlap, so each can be played in turn.
    for (let i = 1; i < notes.length; i++)
      assert.ok(notes[i].beat >= notes[i - 1].beat + notes[i - 1].beats - 1e-9);
  }
});

test("playing the first lesson exactly passes with every note perfect", () => {
  const judge = new Judge(lesson("notes"), { beatSeconds });
  for (const target of lesson("notes").targets)
    judge.note({ beat: target.beat, rung: target.rung, legato: false });
  judge.expire(100);
  const summary = judge.summary();
  assert.equal(summary.hit, summary.total);
  assert.equal(summary.perfect, summary.total);
  assert.ok(passed(summary));
});

test("timing grades follow the millisecond windows", () => {
  const judge = new Judge(lesson("notes"), { beatSeconds });
  // Target 0 at beat 0 on rung 5: 30 ms late is perfect.
  assert.equal(judge.note({ beat: 0.05, rung: 5 }).result.grade, "perfect");
  // Target 1 at beat 2: 120 ms early is good.
  assert.equal(judge.note({ beat: 1.8, rung: 4 }).result.grade, "good");
  // Target 2 at beat 4: 240 ms late is not a hit, and the target becomes a miss.
  assert.equal(judge.note({ beat: 4.4, rung: 3 }), null);
  judge.expire(4.6);
  assert.equal(judge.targets[2].result.grade, "miss");
  // Target 3 at beat 6: the wrong rung on time is marked wrong.
  assert.equal(judge.note({ beat: 6, rung: 9 }).result.grade, "wrong");
});

test("legato notes are reported separately from struck notes", () => {
  const judge = new Judge(lesson("melody"), { beatSeconds });
  for (const target of lesson("melody").targets)
    judge.note({ beat: target.beat, rung: target.rung, legato: target.legato });
  const { kinds } = judge.summary();
  assert.equal(kinds.legato.rate, 1);
  assert.equal(kinds.note.rate, 1);
  assert.ok(kinds.legato.total > kinds.note.total);
});

test("re-pinching every melody target does not pass the legato lesson", () => {
  const judge = new Judge(lesson("melody"), { beatSeconds });
  for (const target of lesson("melody").targets)
    judge.note({ beat: target.beat, rung: target.rung, legato: false });
  const summary = judge.summary();
  assert.equal(summary.kinds.note.rate, 1);
  assert.equal(summary.kinds.legato.hit, 0);
  assert.equal(passed(summary), false);
});

test("a legato move does not count as a new pinch at a phrase start", () => {
  const judge = new Judge(lesson("melody"), { beatSeconds });
  const target = judge.note({ beat: 0, rung: 4, legato: true });
  assert.equal(target.result.grade, "wrong");
});

test("energy is judged by the level the band plays once its downbeat passes", () => {
  const judge = new Judge(lesson("band"), { beatSeconds });
  // Target 0 wants level 2 at beat 8; before then nothing is decided.
  judge.level(7.9, 2);
  assert.equal(judge.targets[0].result, null);
  judge.level(8.3, 2);
  assert.equal(judge.targets[0].result.grade, "good");
  // Target 1 wants level 3 at beat 16, but the band is still at level 2.
  judge.level(16.3, 2);
  assert.equal(judge.targets[1].result.grade, "miss");
  // Energy targets are never expired by time alone.
  judge.expire(30);
  assert.equal(judge.targets[2].result?.grade, undefined);
});

test("cuts, captures, and endings are judged", () => {
  const band = new Judge(lesson("band"), { beatSeconds });
  assert.equal(band.cut({ beat: 28.05, on: true }).result.grade, "perfect");
  assert.equal(band.cut({ beat: 32.5, on: false }).result.grade, "good");
  const piece = new Judge(lesson("piece"), { beatSeconds });
  assert.equal(piece.event("capture", 10), null); // Before its cue.
  assert.ok(piece.event("capture", 18));
  assert.ok(piece.event("end", 60));
  piece.expire(1000);
  assert.ok(!piece.done || piece.targets.every((t) => t.result));
});

test("calibration takes the median offset and bounds it", () => {
  // Pinches land about 50 ms (0.083 beats) late, with one outlier.
  const beats = [1.08, 2.09, 3.08, 4.07, 5.4, 6.08, 7.09];
  const offset = calibrate(beats, beatSeconds);
  assert.ok(Math.abs(offset - 0.048) < 0.001, `${offset}`);
  assert.equal(calibrate([1.5, 2.5, 3.5, 4.4], beatSeconds), -0.15);
  assert.equal(calibrate([1, 2], beatSeconds), null);
});
