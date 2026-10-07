import { test } from "node:test";
import assert from "node:assert/strict";
import { Coach } from "../web/instrument/coach.js";
import { LESSONS } from "../web/instrument/tutorial.js";

function harness({ camera = true } = {}) {
  const log = {
    cards: [],
    range: null,
    offset: undefined,
    engines: [],
    ended: 0,
  };
  let now = 0;
  let engineState = null;
  let level = 1;
  const coach = new Coach({
    startEngine: ({ level }) => {
      log.engines.push(level);
      engineState = "playing";
    },
    stopEngine: () => (engineState = null),
    endEngine: () => {
      log.ended++;
      engineState = "finished";
    },
    engineState: () => engineState,
    engineLevel: () => level,
    showCard: (card) => log.cards.push(card),
    hideCard: () => {},
    setRange: (range) => (log.range = range),
    setCompensation: (offset) => (log.offset = offset),
    camera: () => camera,
    leadName: () => "right",
    now: () => now,
    beatSeconds: () => 0.6,
    currentRung: () => 4,
    freePlay: () => log.cards.push({ title: "free play" }),
    record: (id, summary) => (log.recorded = { id, summary }),
  });
  const card = () => log.cards.at(-1);
  const press = (label) => {
    const action = card().actions.find((a) => a.label === label);
    assert.ok(action, `no "${label}" on "${card().title}"`);
    action.run();
  };
  const hold = (y, from, seconds = 1.2) => {
    for (let t = from; t <= from + seconds; t += 0.1) {
      now = t;
      coach.onHands({ y }, t);
    }
    return from + seconds;
  };
  const setLevel = (value) => (level = value);
  return { coach, log, card, press, hold, setLevel };
}

test("setup fits the ladder to the player's reach", () => {
  const { coach, log, card, hold } = harness();
  coach.begin();
  assert.equal(coach.phase, "reach-high");
  let t = hold(0.2, 0);
  assert.equal(coach.phase, "reach-low");
  // Resting where the high reach was recorded does not count as the low reach.
  t = hold(0.22, t + 0.1);
  assert.equal(coach.phase, "reach-low");
  hold(0.8, t + 0.1);
  assert.deepEqual(log.range, { top: 0.2, bottom: 0.8 });
  assert.equal(card().title, "Find your timing");
});

test("without a camera, setup goes straight to timing", () => {
  const { coach, card } = harness({ camera: false });
  coach.begin();
  assert.equal(card().title, "Find your timing");
});

test("leaving a lesson introduction resumes free play", () => {
  const { coach, card, press } = harness({ camera: false });
  coach.begin();
  press("Skip");
  press("Back to free play");
  assert.equal(coach.active, false);
  assert.equal(coach.judge, null);
  assert.equal(card().title, "free play");
});

test("timing calibration measures the offset and moves on to lesson 1", () => {
  const { coach, log, card, press } = harness({ camera: false });
  coach.begin();
  press("Start");
  assert.equal(coach.phase, "timing");
  assert.equal(log.offset, null); // Measured without a previous correction.
  for (let i = 0; i < 8; i++) coach.onNote({ gesture: 4 + i + 0.05, rung: 4 });
  coach.tick(12.6);
  assert.ok(Math.abs(log.offset - 0.03) < 1e-9, `${log.offset}`);
  assert.equal(card().title, "Your instrument is tuned to you");
  press("Continue to lesson 1");
  assert.equal(card().title, LESSONS[0].title);
});

test("too few pinches ask to try the timing again", () => {
  const { coach, card } = harness({ camera: false });
  coach.begin();
  card().actions[0].run();
  coach.onNote({ gesture: 4, rung: 4 });
  coach.tick(13);
  assert.equal(card().title, "Let's try that again");
});

test("lessons lock the band controls they are not teaching", () => {
  const { coach, press } = harness({ camera: false });
  coach.begin();
  press("Skip");
  press("Start lesson");
  assert.equal(coach.phase, "lesson");
  assert.equal(coach.allows("energy"), false);
  assert.equal(coach.allows("end"), false);
  coach.exit();
  assert.equal(coach.allows("energy"), true);
});

test("a lesson played on its targets ends on the final chord with results", () => {
  const { coach, log, card, press } = harness({ camera: false });
  coach.begin();
  press("Skip");
  press("Start lesson");
  assert.deepEqual(log.engines, [LESSONS[0].level]);
  for (const target of LESSONS[0].targets) {
    coach.onNote({ gesture: 4 + target.beat, rung: target.rung });
    coach.tick(4 + target.beat + 0.1);
  }
  // Every target is resolved: the band is asked to end, and results follow.
  assert.equal(log.ended, 1);
  coach.tick(40);
  assert.equal(coach.phase, "results");
  assert.equal(card().title, "Beautiful");
  assert.equal(log.recorded.id, "notes");
  assert.equal(log.recorded.summary.hit, LESSONS[0].targets.length);
  press("Next lesson");
  assert.equal(card().title, LESSONS[1].title);
});

test("the band lesson credits its level at each cue, however early it was asked for", () => {
  const { coach, card, press, setLevel } = harness({ camera: false });
  coach.openLesson("band");
  press("Start lesson");
  assert.equal(coach.allows("energy"), true);
  assert.equal(coach.allows("capture"), false);
  // Chart beats plus the one-bar count-in; energy is raised well before each cue.
  const at = (beat) => beat + 4;
  setLevel(2);
  coach.tick(at(8.5));
  setLevel(3);
  coach.tick(at(16.5));
  setLevel(4);
  coach.tick(at(24.5));
  coach.onControl({ type: "cut", on: true }, at(28.1));
  coach.onControl({ type: "cut", on: false }, at(32.2));
  setLevel(1);
  coach.tick(at(36.5));
  coach.tick(at(41));
  coach.tick(at(42));
  assert.equal(coach.phase, "results");
  assert.equal(card().body, "You hit 6 of 6 targets.");
});

test("camera lessons include expression and mouse lessons skip it", () => {
  for (const camera of [true, false]) {
    const { coach } = harness({ camera });
    coach.begin();
    assert.equal(
      coach.lessons.some((lesson) => lesson.id === "expression"),
      camera,
    );
    assert.ok(coach.lessons.some((lesson) => lesson.id === "piece"));
  }
});

test("expression judges the velocity actually played, not just a correctly timed note", () => {
  const { coach, press } = harness();
  coach.openLesson("expression");
  press("Start lesson");
  coach.onNote({ gesture: 4, rung: 4, velocity: 1 });
  assert.equal(coach.judge.targets[0].result, null);
  coach.onNote({ gesture: 4.05, rung: 4, velocity: 0.4 });
  assert.equal(coach.judge.targets[0].result.grade, "perfect");
});
