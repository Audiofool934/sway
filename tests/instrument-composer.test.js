import { test } from "node:test";
import assert from "node:assert/strict";
import {
  answerEvents,
  answerNotes,
  cleanPlan,
  harmonyNotes,
} from "../web/instrument/arrange.js";
import { Composer } from "../web/instrument/composer.js";
import { Engine } from "../web/instrument/engine.js";
import { CHORDS, WORLD } from "../web/instrument/theory.js";

const BAR = (WORLD.beatsPerBar * 60) / WORLD.tempo; // 2.4 s
const PLAN = {
  chords: ["Dm", "Am", "F", "Em"],
  texture: "pulse",
  answer: [
    { rung: 4, at: 28, len: 3 },
    { rung: 2, at: 60, len: 4 },
  ],
  caption: "I echo your climb low in bars 2 and 4.",
};

// Arrangement: what each bar of a plan plays.

test("held chords carry common tones over the bar line", () => {
  const notes = harmonyNotes({
    chord: CHORDS.F,
    texture: "hold",
    previous: { chord: CHORDS.Am, texture: "hold" },
    world: WORLD,
  });
  assert.deepEqual(
    notes.map(({ pitch, start, length, tie }) => [pitch, start, length, tie]),
    [
      [53, 0, 4, false],
      [57, 0, 4, true],
      [60, 0, 4, true],
      [64, 0, 4, true],
    ],
  );
});

test("pulsed chords strike every beat and arpeggios climb in eighths", () => {
  const pulse = harmonyNotes({
    chord: CHORDS.Am,
    texture: "pulse",
    world: WORLD,
  });
  assert.equal(pulse.length, 16);
  assert.ok(pulse.every((note) => !note.tie && note.length === 1));
  assert.deepEqual([...new Set(pulse.map((note) => note.start))], [0, 1, 2, 3]);
  const arpeggio = harmonyNotes({
    chord: CHORDS.Am,
    texture: "arpeggio",
    world: WORLD,
  });
  assert.deepEqual(
    arpeggio.map((note) => note.pitch),
    [57, 60, 64, 67, 57, 60, 64, 67],
  );
  assert.deepEqual(
    arpeggio.map((note) => note.start),
    [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
  );
});

test("the answering line sits an octave below the ladder and splits at bar lines", () => {
  // Rung 4 (G4) from sixteenth 14 for four sixteenths: two in bar 0, two in bar 1.
  const answer = [{ rung: 4, at: 14, len: 4 }];
  const [end] = answerNotes({ answer, barInCycle: 0, world: WORLD });
  const [start] = answerNotes({ answer, barInCycle: 1, world: WORLD });
  assert.equal(end.pitch, WORLD.ladder[4] - 12);
  assert.equal(end.start, 3.5);
  assert.equal(end.tie, false);
  assert.equal(start.start, 0);
  assert.equal(start.tie, true);
  assert.ok(Math.abs(start.length - 0.5) < 1e-9);
  // Odd sixteenths are swung like the band's.
  const [swung] = answerNotes({
    answer: [{ rung: 0, at: 1, len: 1 }],
    barInCycle: 0,
    world: WORLD,
  });
  assert.ok(swung.start > 0.25);
  const events = answerEvents({ answer, stepInCycle: 14, world: WORLD });
  assert.deepEqual(events, [
    { part: "answer", step: 14, beats: 1, velocity: 0.6, pitch: 55 },
  ]);
});

test("a plan is cleaned before it can play", () => {
  const plan = cleanPlan(PLAN, { world: WORLD, chords: CHORDS });
  assert.deepEqual(plan.names, PLAN.chords);
  assert.equal(plan.chords[0], CHORDS.Dm);
  assert.deepEqual(plan.answer, PLAN.answer);
  for (const broken of [
    { ...PLAN, chords: ["Dm", "Am", "F"] },
    { ...PLAN, chords: ["Dm", "Am", "F", "E"] },
    { ...PLAN, texture: "strum" },
    null,
  ])
    assert.equal(cleanPlan(broken, { world: WORLD, chords: CHORDS }), null);
  const repaired = cleanPlan(
    {
      ...PLAN,
      answer: [
        { rung: 5, at: 40, len: 30 }, // Longer than a bar: capped.
        { rung: 3, at: 20, len: 8 },
        { rung: 2, at: 24, len: 2 }, // Overlaps the note at 20.
        { rung: 11, at: 30, len: 2 }, // Off the ladder.
        { rung: 1, at: 62, len: 9 }, // Clipped to the cycle.
        { rung: 1.5, at: 58, len: 1 },
      ],
      caption: " Line  one\nline two ",
    },
    { world: WORLD, chords: CHORDS },
  );
  assert.deepEqual(repaired.answer, [
    { rung: 3, at: 20, len: 8 },
    { rung: 5, at: 40, len: 16 },
    { rung: 1, at: 62, len: 2 },
  ]);
  assert.equal(repaired.caption, "Line one line two");
});

// The page's composer client.

function fakeServer() {
  const calls = [];
  const fetch = (url, options) =>
    new Promise((resolve, reject) => {
      options.signal?.addEventListener("abort", () =>
        reject(new DOMException("Aborted", "AbortError")),
      );
      calls.push({ url, body: JSON.parse(options.body), resolve });
    });
  return { calls, fetch };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status });
const CONTEXT = {
  level: 2,
  earlier_levels: [1],
  current: ["Am", "F", "C", "G"],
  history: [],
  phrase: [{ rung: 4, at: 0, len: 4 }],
  previous_answer: [],
};

test("the composer asks for each cycle once and hands its plan over once", async () => {
  const server = fakeServer();
  const composer = new Composer({ world: WORLD, fetch: server.fetch });
  composer.request(3, CONTEXT);
  composer.request(3, CONTEXT);
  assert.equal(server.calls.length, 1);
  const { body } = server.calls[0];
  assert.equal(body.cycle, 3);
  assert.deepEqual(body.phrase, CONTEXT.phrase);
  assert.deepEqual(body.world.ladder.slice(0, 3), ["A3", "C4", "D4"]);
  assert.deepEqual(body.world.vocabulary, WORLD.vocabulary);
  assert.equal(composer.take(3), null); // Still being written.
  server.calls[0].resolve(
    json({
      cycle: 3,
      plan: PLAN,
      ms: 2300,
      model: "qwen3.8-max",
      tokens: { prompt_tokens: 450, completion_tokens: 80 },
    }),
  );
  await settle();
  const plan = composer.take(3);
  assert.deepEqual(plan.names, PLAN.chords);
  assert.equal(plan.model, "qwen3.8-max");
  assert.equal(composer.take(3), null); // Taken once.
  assert.deepEqual(composer.stats.ms, [2300]);
  assert.equal(
    composer.stats.promptTokens + composer.stats.completionTokens,
    530,
  );
});

test("a plan that cannot play is counted as a miss", async () => {
  const server = fakeServer();
  const composer = new Composer({ world: WORLD, fetch: server.fetch });
  composer.request(2, CONTEXT);
  server.calls[0].resolve(
    json({ cycle: 2, plan: { ...PLAN, texture: "strum" } }),
  );
  await settle();
  assert.equal(composer.take(2), null);
  assert.equal(composer.stats.failed, 1);
  assert.equal(composer.active, true);
});

test("without a key the composer stops, and a rate limit rests it for two cycles", async () => {
  const server = fakeServer();
  const limited = new Composer({ world: WORLD, fetch: server.fetch });
  limited.request(4, CONTEXT);
  server.calls[0].resolve(json({ detail: "Qwen is limiting requests" }, 429));
  await settle();
  limited.request(5, CONTEXT);
  assert.equal(server.calls.length, 1);
  limited.request(6, CONTEXT);
  assert.equal(server.calls.length, 2);
  const unconfigured = new Composer({ world: WORLD, fetch: server.fetch });
  unconfigured.request(1, CONTEXT);
  server.calls[2].resolve(
    json({ detail: "Qwen is not configured: no key" }, 503),
  );
  await settle();
  assert.equal(unconfigured.state, "failed");
  assert.match(unconfigured.error, /not configured/);
  unconfigured.request(2, CONTEXT);
  assert.equal(server.calls.length, 3);
});

test("stopping the composer abandons plans still being written", async () => {
  const server = fakeServer();
  const composer = new Composer({ world: WORLD, fetch: server.fetch });
  composer.request(1, CONTEXT);
  composer.stop();
  server.calls[0].resolve(json({ cycle: 1, plan: PLAN, ms: 2000 }));
  await settle();
  assert.equal(composer.take(1), null);
  assert.equal(composer.stats.failed, 0);
});

// The engine playing the composer's plans.

class FakeComposer {
  constructor() {
    this.requests = [];
    this.plans = new Map();
    this.stopped = false;
  }
  request(cycle, context) {
    this.requests.push({ cycle, context });
  }
  take(cycle) {
    return this.plans.get(cycle) ?? null;
  }
  arrive(cycle, plan = PLAN) {
    this.plans.set(cycle, cleanPlan(plan, { world: WORLD, chords: CHORDS }));
  }
  stop() {
    this.stopped = true;
  }
}

function band(t, { level = 1 } = {}) {
  let tick;
  t.mock.method(globalThis, "setInterval", (callback) => {
    tick = callback;
    return 1;
  });
  t.mock.method(globalThis, "clearInterval", () => {});
  const ctx = { currentTime: 0 };
  const played = [];
  const synth = {
    setTempo() {},
    play(event, time) {
      played.push({ ...event, time });
      return null;
    },
  };
  const composer = new FakeComposer();
  const engine = new Engine(ctx, synth, { composer, level });
  const events = [];
  engine.on((event) => events.push(event));
  engine.start(0);
  t.after(() => engine.stop());
  const until = (seconds) => {
    while (ctx.currentTime < seconds - 1e-9) {
      ctx.currentTime = Math.min(seconds, ctx.currentTime + 0.02);
      tick();
    }
  };
  return { ctx, engine, composer, played, events, until };
}

test("a plan that arrives in time is what the band plays next", (t) => {
  const { engine, composer, played, events, until } = band(t);
  // At the first bar line the composer is asked for the next cycle.
  assert.equal(composer.requests[0].cycle, 1);
  composer.arrive(1);
  until(4 * BAR + 0.1);
  assert.equal(engine.barInfo(4).chord.name, "Dm");
  assert.equal(engine.barInfo(4).composed, true);
  assert.equal(engine.barInfo(3).next.name, "Dm"); // The "then" chord is the real one.
  const composed = events.find((event) => event.type === "composed");
  assert.equal(composed.cycle, 1);
  assert.equal(composed.plan.caption, PLAN.caption);
  assert.deepEqual(engine.composed[0].chords, PLAN.chords);
  // The answering line plays on its sixteenth, an octave below the ladder.
  until(6 * BAR);
  const answer = played.filter((event) => event.part === "answer");
  assert.equal(answer.length, 1);
  assert.equal(answer[0].pitch, WORLD.ladder[4] - 12);
  const sixteenth = BAR / 16;
  assert.ok(Math.abs(answer[0].time - (4 * BAR + 28 * sixteenth)) < 0.02);
  // Pulse is a texture for generated harmony; the synthesized pad still holds each bar.
  const pads = played.filter(
    (e) =>
      e.part === "pad" && e.time >= 4 * BAR - 1e-6 && e.time < 6 * BAR - 1e-6,
  );
  assert.equal(pads.length, 2);
});

test("a plan that arrives after its cycle is settled is not used", (t) => {
  const { engine, composer, until } = band(t);
  until(2 * BAR + 0.1); // Cycle 1 settles at bar 2, two bars ahead.
  composer.arrive(1);
  until(4 * BAR + 0.1);
  assert.equal(engine.barInfo(4).chord.name, "Am");
  assert.equal(engine.barInfo(4).composed, false);
  assert.equal(engine.composed.length, 0);
});

test("the composer hears the energy, the chords, and the player's last cycle", (t) => {
  const { engine, composer, until } = band(t);
  // A played phrase in cycle 0: G4 on beat 1 for a beat, then A4 on sixteenth 9.
  engine.log.push(
    { part: "lead", pitch: 67, start: 1, beats: 1, velocity: 0.8 },
    { part: "lead", pitch: 69, start: 2.25, beats: null, velocity: 0.8 },
  );
  engine.setEnergy(2);
  until(4 * BAR + 0.1);
  const { cycle, context } = composer.requests.at(-1);
  assert.equal(cycle, 2);
  assert.deepEqual(context.phrase, [
    { rung: 4, at: 4, len: 4 },
    { rung: 5, at: 9, len: 55 }, // Still held: counted to the end of the cycle.
  ]);
  assert.deepEqual(context.current, ["Am", "F", "C", "G"]);
  assert.deepEqual(context.history, ["Am", "F", "C", "G"]);
  assert.deepEqual(context.earlier_levels, [1]);
  assert.equal(context.level, 2);
});

test("the bass leads into the composer's next chord", (t) => {
  const { composer, played, until } = band(t, { level: 3 });
  composer.arrive(1);
  until(4 * BAR);
  // At level 3 the last eighth of each bar approaches the next chord's root.
  const approach = played.find(
    (event) =>
      event.part === "bass" &&
      Math.abs(event.time - (3 * BAR + (14 * BAR) / 16)) < 0.03,
  );
  assert.equal(approach.pitch, CHORDS.Dm.bass);
});

test("stopping the band stops the composer", (t) => {
  const { engine, composer } = band(t);
  engine.stop();
  assert.equal(composer.stopped, true);
});
