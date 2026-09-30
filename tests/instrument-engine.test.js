import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../web/instrument/engine.js";

for (const offset of [-0.05, 0.5]) {
  test(`stopping an ended engine releases its final chord ${offset < 0 ? "before it starts" : "while it sounds"}`, (t) => {
    let tick;
    t.mock.method(globalThis, "setInterval", (callback) => {
      tick = callback;
      return 1;
    });
    t.mock.method(globalThis, "clearInterval", () => {});
    const ctx = { currentTime: 10 };
    const played = [];
    const synth = {
      setTempo() {},
      play(event, time) {
        if (!["crash", "bass", "pad", "keys"].includes(event.part)) return;
        const releases = [];
        const handle = { release: (at) => releases.push(at) };
        played.push({ part: event.part, time, releases });
        return handle;
      },
    };
    const engine = new Engine(ctx, synth);
    engine.start(ctx.currentTime);
    t.after(() => engine.stop());
    engine.end();
    const endingAt = engine.transport.timeAt(4);
    ctx.currentTime = endingAt - 0.06;
    tick();
    assert.equal(engine.state, "finished");
    const ending = played.filter((voice) => voice.time === endingAt);
    assert.deepEqual(
      ending.map((voice) => voice.part),
      ["crash", "bass", "pad", "keys"],
    );
    assert.ok(ending.every((voice) => voice.releases.length === 0));
    ctx.currentTime = endingAt + offset;
    engine.stop();
    for (const voice of ending)
      assert.deepEqual(voice.releases, [ctx.currentTime], voice.part);
  });
}
