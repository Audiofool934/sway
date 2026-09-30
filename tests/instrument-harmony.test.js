import { test } from "node:test";
import assert from "node:assert/strict";
import { PAD } from "../web/instrument/band.js";
import { Engine } from "../web/instrument/engine.js";
import { GeneratedHarmony, LEAD, toBuffer } from "../web/instrument/harmony.js";
import { WORLD, chordAt } from "../web/instrument/theory.js";

const BAR = (WORLD.beatsPerBar * 60) / WORLD.tempo; // 2.4 s
const RATE = 48000;
const AM = chordAt(WORLD, "low", 0);
// Am held for the bar, as the engine describes a bar to the harmony.
const AM_BAR = {
  chord: "Am",
  notes: AM.pad.map((pitch) => ({ pitch, start: 0, length: 4, tie: false })),
  tones: AM.tones,
};

function fakeContext() {
  const param = () => ({
    value: 0,
    events: [],
    setTargetAtTime(value, time) {
      this.events.push(["target", value, time]);
    },
    setValueAtTime(value, time) {
      this.events.push(["set", value, time]);
    },
  });
  const node = (extra) => ({
    connect(next) {
      return next;
    },
    disconnect() {
      this.disconnected = true;
    },
    ...extra,
  });
  const ctx = {
    currentTime: 0,
    sources: [],
    gains: [],
    createGain() {
      const gain = node({ gain: param() });
      ctx.gains.push(gain);
      return gain;
    },
    createBiquadFilter: () => node({ type: "", frequency: param() }),
    createBuffer(channels, frames, sampleRate) {
      const data = Array.from(
        { length: channels },
        () => new Float32Array(frames),
      );
      return {
        sampleRate,
        duration: frames / sampleRate,
        getChannelData: (c) => data[c],
      };
    },
    createBufferSource() {
      const source = node({
        starts: [],
        stops: [],
        start(time) {
          this.starts.push(time);
        },
        stop(time) {
          this.stops.push(time);
        },
      });
      ctx.sources.push(source);
      return source;
    },
  };
  return ctx;
}

const barAudio = (seconds = BAR, amplitude = 0) =>
  new Response(
    new Int16Array(Math.round(seconds * RATE) * 2).fill(
      Math.round(amplitude * 32768),
    ).buffer,
    {
      headers: {
        "X-Channels": "2",
        "X-Sample-Rate": "48000",
        "X-Render-Ms": "1180",
      },
    },
  );

// A server whose responses the test releases one at a time.
function fakeServer() {
  const calls = [];
  const fetch = (url, options) =>
    new Promise((resolve, reject) => {
      const call = { url, body: JSON.parse(options.body), resolve };
      options.signal?.addEventListener("abort", () =>
        reject(new DOMException("Aborted", "AbortError")),
      );
      calls.push(call);
    });
  return { calls, fetch };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a bar's chord is rendered and kept until its bar line", async () => {
  const ctx = fakeContext();
  const server = fakeServer();
  const harmony = new GeneratedHarmony(
    ctx,
    {},
    { palette: "choir", world: WORLD, fetch: server.fetch },
  );
  harmony.request(5, AM_BAR);
  harmony.request(5, AM_BAR); // Asked once, however often the engine asks.
  assert.equal(server.calls.length, 1);
  assert.deepEqual(server.calls[0].body, {
    bar: 5,
    notes: AM_BAR.notes,
    tones: AM.tones,
    palette: "choir",
    stream: 0, // Set to the piece's seed by start().
    tempo: WORLD.tempo,
    beats_per_bar: WORLD.beatsPerBar,
  });
  assert.equal(harmony.ready(5), false);
  server.calls[0].resolve(barAudio());
  await settle();
  assert.equal(harmony.ready(5), true);
  assert.deepEqual(harmony.stats.renderMs, [1180]);
  // The chord change lands on the bar line, so the bar starts that much earlier.
  const handle = harmony.play(5, 30);
  assert.deepEqual(ctx.sources[0].starts, [30 - LEAD.choir]);
  assert.equal(harmony.ready(5), false);
  // The engine asks for each bar at two bar lines; once placed, it is not rendered again.
  harmony.request(5, AM_BAR);
  assert.equal(server.calls.length, 1);
  harmony.passed(5, true);
  assert.equal(harmony.last, "generated");
  // Released before it starts, it never sounds; released later, it fades out.
  handle.release(29);
  const amp = ctx.gains.at(-1);
  assert.deepEqual(amp.gain.events, [["set", 0, 29]]);
  handle.release(31); // Only the first release counts.
  assert.equal(amp.gain.events.length, 1);
});

test("a bar of the wrong length is refused", async () => {
  const ctx = fakeContext();
  const server = fakeServer();
  const harmony = new GeneratedHarmony(
    ctx,
    {},
    { world: WORLD, fetch: server.fetch },
  );
  harmony.request(2, AM_BAR);
  server.calls[0].resolve(barAudio(BAR - 0.04));
  await settle();
  assert.equal(harmony.ready(2), false);
  assert.match(harmony.error, /wrong length/);
  assert.equal(harmony.active, true); // Later bars may still arrive.
});

test("without MRT2 the page stops asking and the pad plays", async () => {
  const ctx = fakeContext();
  const server = fakeServer();
  const harmony = new GeneratedHarmony(
    ctx,
    {},
    { world: WORLD, fetch: server.fetch },
  );
  harmony.request(1, AM_BAR);
  server.calls[0].resolve(
    new Response(JSON.stringify({ detail: "MRT2 is not installed." }), {
      status: 503,
    }),
  );
  await settle();
  assert.equal(harmony.state, "failed");
  assert.equal(harmony.error, "MRT2 is not installed.");
  harmony.request(2, AM_BAR);
  assert.equal(server.calls.length, 1);
  harmony.passed(1, false);
  assert.equal(harmony.last, "fallback");
  assert.equal(harmony.stats.missed, 1);
});

test("each piece's bars carry its seed, and bars for a replaced piece are dropped", async () => {
  const ctx = fakeContext();
  const server = fakeServer();
  const harmony = new GeneratedHarmony(
    ctx,
    {},
    { world: WORLD, fetch: server.fetch },
  );
  harmony.start(1234);
  server.calls[0].resolve(new Response("{}"));
  await settle();
  assert.equal(harmony.state, "ready");
  harmony.request(1, AM_BAR);
  assert.equal(server.calls[1].body.stream, 1234);
  server.calls[1].resolve(
    new Response(JSON.stringify({ detail: "That piece has ended" }), {
      status: 409,
    }),
  );
  await settle();
  assert.equal(harmony.ready(1), false);
  assert.equal(harmony.error, null);
  assert.equal(harmony.active, true);
});

test("stopping aborts renders in flight and ignores late answers", async () => {
  const ctx = fakeContext();
  const server = fakeServer();
  const harmony = new GeneratedHarmony(
    ctx,
    {},
    { world: WORLD, fetch: server.fetch },
  );
  harmony.request(3, AM_BAR);
  harmony.request(4, AM_BAR);
  harmony.stop();
  await settle();
  assert.equal(harmony.requests.size, 0);
  assert.equal(harmony.ready(3), false);
  assert.equal(harmony.error, null); // An abort is not an error.
  harmony.request(5, AM_BAR);
  assert.equal(server.calls.length, 2);
});

test("the harmony follows the band's energy like the pad", () => {
  const ctx = fakeContext();
  const harmony = new GeneratedHarmony(
    ctx,
    {},
    { palette: "strings", world: WORLD, fetch: () => {} },
  );
  harmony.setLevel(0, 12);
  harmony.setLevel(4, 14.4);
  const [quiet, loud] = harmony.bus.gain.events;
  assert.equal(quiet[2], 12);
  assert.ok(Math.abs(quiet[1] / loud[1] - PAD.gain[0] / PAD.gain[4]) < 1e-9);
  const [dark, bright] = harmony.filter.frequency.events;
  assert.ok(bright[1] > dark[1]);
});

test("generated bars are matched to the synthesized pad's loudness", async () => {
  const ctx = fakeContext();
  const server = fakeServer();
  const harmony = new GeneratedHarmony(
    ctx,
    {},
    { world: WORLD, fetch: server.fetch },
  );
  const gainAfter = async (bar, amplitude) => {
    harmony.request(bar, AM_BAR);
    server.calls.at(-1).resolve(barAudio(BAR, amplitude));
    await settle();
    harmony.setLevel(1, bar);
    return harmony.bus.gain.events.at(-1)[1];
  };
  const quiet = await gainAfter(1, 0.01);
  const louder = await gainAfter(2, 0.04);
  // The running loudness moved about 30% of the way to the louder bar, and the gain
  // fell to match (amplitudes as stored in 16 bits).
  const q = (amplitude) => Math.round(amplitude * 32768) / 32768;
  const running = q(0.01) + 0.3 * (q(0.04) - q(0.01));
  assert.ok(Math.abs(louder / quiet - q(0.01) / running) < 1e-9);
  // A silent stream cannot push the gain past its limit.
  const silent = new GeneratedHarmony(
    ctx,
    {},
    { world: WORLD, fetch: server.fetch },
  );
  silent.request(1, AM_BAR);
  server.calls.at(-1).resolve(barAudio(BAR, 0));
  await settle();
  silent.setLevel(0, 0);
  assert.ok(silent.bus.gain.events.at(-1)[1] <= 30 * PAD.gain[0] + 1e-9);
});

test("PCM becomes an AudioBuffer channel by channel", () => {
  const ctx = fakeContext();
  const buffer = toBuffer(
    ctx,
    new Int16Array([16384, -32768, 0, 32767]),
    2,
    RATE,
  );
  assert.deepEqual([...buffer.getChannelData(0)], [0.5, 0]);
  assert.deepEqual([...buffer.getChannelData(1)], [-1, 32767 / 32768]);
});

// The engine with a stand-in harmony layer, on a clock the test moves by hand.
class FakeHarmony {
  constructor() {
    this.lead = LEAD.strings;
    this.requests = [];
    this.levels = [];
    this.passedBars = [];
    this.arrived = new Set();
    this.played = [];
    this.stopped = false;
  }
  request(bar, description) {
    this.requests.push([bar, description.chord]);
  }
  ready(bar) {
    return this.arrived.has(bar);
  }
  play(bar, time) {
    this.arrived.delete(bar);
    const handle = { bar, time, releasedAt: null };
    handle.release = (at) => (handle.releasedAt ??= at);
    this.played.push(handle);
    return handle;
  }
  passed(bar, generated) {
    this.passedBars.push([bar, generated]);
  }
  setLevel(level, time) {
    this.levels.push([level, time]);
  }
  stop() {
    this.stopped = true;
  }
}

function band(t) {
  let tick;
  t.mock.method(globalThis, "setInterval", (callback) => {
    tick = callback;
    return 1;
  });
  t.mock.method(globalThis, "clearInterval", () => {});
  const ctx = { currentTime: 0 };
  const pads = [];
  const shadows = [];
  const synth = {
    setTempo() {},
    play(event, time) {
      if (event.part === "pad") (event.shadow ? shadows : pads).push(time);
      return null;
    },
  };
  const harmony = new FakeHarmony();
  const engine = new Engine(ctx, synth, { harmony });
  engine.start(0);
  t.after(() => engine.stop());
  // Run the scheduler up to `seconds`, in its 20 ms ticks.
  const until = (seconds) => {
    while (ctx.currentTime < seconds - 1e-9) {
      ctx.currentTime = Math.min(seconds, ctx.currentTime + 0.02);
      tick();
    }
  };
  return { ctx, engine, harmony, pads, shadows, until };
}

const near = (a, b) => Math.abs(a - b) < 1e-6;

test("a generated bar is placed ahead of its bar line and replaces the pad", (t) => {
  const { engine, harmony, pads, shadows, until } = band(t);
  harmony.arrived.add(1);
  until(0.1);
  assert.equal(harmony.played.length, 1);
  assert.ok(near(harmony.played[0].time, BAR));
  until(BAR + 0.1);
  // The synthesized pad played bar 0 only; bar 1's chord still went into the log.
  assert.deepEqual(pads, [0]);
  // The listening test's stand-in plays under bar 1, silent until MRT2 is muted.
  assert.deepEqual(shadows, [BAR]);
  const logged = engine.log.filter((note) => note.part === "pad");
  assert.deepEqual(new Set(logged.map((note) => note.start)), new Set([0, 4]));
  assert.deepEqual(harmony.passedBars, [
    [0, false],
    [1, true],
  ]);
  // Each bar line asks for the chords one and two bars ahead.
  assert.deepEqual(harmony.requests.slice(0, 2), [
    [1, "F"],
    [2, "C"],
  ]);
});

test("a bar that arrives too close to its bar line keeps the synthesized pad", (t) => {
  const { harmony, pads, until } = band(t);
  until(BAR - LEAD.strings - 0.04);
  harmony.arrived.add(1);
  until(BAR + 0.1);
  assert.equal(harmony.played.length, 0);
  assert.equal(pads.length, 2);
  assert.deepEqual(harmony.passedBars.at(-1), [1, false]);
});

test("a cut releases generated bars and nothing new starts until the band returns", (t) => {
  const { engine, harmony, until } = band(t);
  harmony.arrived.add(1);
  until(0.5);
  engine.setCut(true);
  until(0.9);
  assert.ok(harmony.played[0].releasedAt !== null);
  harmony.arrived.add(2);
  until(BAR + 0.5);
  assert.equal(harmony.played.length, 1); // Held back during the cut.
  engine.setCut(false); // The band returns on the next bar line.
  until(BAR + 0.6);
  assert.equal(harmony.played.length, 2);
  assert.ok(near(harmony.played[1].time, 2 * BAR));
});

test("the ending replaces a generated bar waiting on its bar line", (t) => {
  const { engine, harmony, until } = band(t);
  harmony.arrived.add(1);
  until(0.5);
  engine.end();
  assert.equal(harmony.played[0].releasedAt, 0.5);
  until(BAR + 0.5);
  assert.equal(engine.state, "finished");
  assert.equal(harmony.stopped, true);
});

test("each progression is settled two bars before its cycle begins", (t) => {
  // Raised during bar 1, the energy reaches the band at bar 2, in time for cycle 1.
  const early = band(t);
  early.until(1.5 * BAR);
  early.engine.setEnergy(3);
  early.until(4 * BAR + 0.1);
  assert.equal(early.engine.barInfo(4).chord.name, "F"); // The bright progression.
  assert.ok(
    early.harmony.requests.some(([bar, name]) => bar === 4 && name === "F"),
  );
});

test("energy raised after that keeps the next cycle and changes the one after", (t) => {
  const late = band(t);
  late.until(2.5 * BAR);
  late.engine.setEnergy(3);
  late.until(8 * BAR + 0.1);
  assert.equal(late.engine.barInfo(4).chord.name, "Am");
  assert.equal(late.engine.barInfo(8).chord.name, "F");
  // The heads-up display's "then" chord is the one actually coming.
  assert.equal(late.engine.barInfo(7).next.name, "F");
});
