// The band's composer. At the start of each four-bar cycle the page asks the local server,
// which asks Qwen, to write the cycle after it. A plan that is missing, invalid, or late
// leaves that cycle to the built-in progression, so the music never waits.

import { cleanPlan } from "./arrange.js";
import { CHORDS, noteName } from "./theory.js";

const JSON_HEADERS = { "Content-Type": "application/json" };
const octave = (pitch) => Math.floor(pitch / 12) - 1;

export class Composer {
  constructor({ world, fetch = (...args) => globalThis.fetch(...args) } = {}) {
    this.world = world;
    this.fetch = fetch;
    this.plans = new Map(); // Cycle to its plan, until the band takes it.
    this.requests = new Map(); // Cycle to its AbortController while Qwen writes.
    this.state = "ready"; // ready, failed, stopped
    this.error = null;
    this.quietUntil = 0; // After a rate limit, the first cycle to ask for again.
    this.stats = {
      requested: 0,
      arrived: 0,
      failed: 0,
      ms: [],
      promptTokens: 0,
      completionTokens: 0,
    };
  }

  get active() {
    return this.state === "ready";
  }

  /** The world as the server's prompt describes it. */
  #world() {
    const { world } = this;
    return {
      name: world.name,
      key: world.key,
      tempo: world.tempo,
      beats_per_bar: world.beatsPerBar,
      cycle_bars: world.cycleBars,
      vocabulary: world.vocabulary,
      ladder: world.ladder.map((pitch) => noteName(pitch) + octave(pitch)),
      levels: world.levels,
    };
  }

  /**
   * Asks for `cycle`'s plan. `context` describes the music so far: { level,
   * earlier_levels, current, history, phrase, previous_answer }.
   */
  request(cycle, context) {
    if (!this.active || cycle < this.quietUntil) return;
    if (this.plans.has(cycle) || this.requests.has(cycle)) return;
    const controller = new AbortController();
    this.requests.set(cycle, controller);
    this.stats.requested++;
    this.fetch("/api/compose", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ world: this.#world(), cycle, ...context }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          // Unconfigured or refused: no later request can succeed. Rate limited: rest.
          if (response.status === 503) this.state = "failed";
          if (response.status === 429) this.quietUntil = cycle + 2;
          throw new Error(
            typeof body.detail === "string"
              ? body.detail
              : `HTTP ${response.status}`,
          );
        }
        const plan = cleanPlan(body.plan, {
          world: this.world,
          chords: CHORDS,
        });
        if (!plan) throw new Error("Qwen's plan could not be played");
        if (!this.active) return;
        this.plans.set(cycle, { ...plan, ms: body.ms, model: body.model });
        this.stats.arrived++;
        if (Number.isFinite(body.ms)) {
          this.stats.ms.push(body.ms);
          if (this.stats.ms.length > 60) this.stats.ms.shift();
        }
        this.stats.promptTokens += body.tokens?.prompt_tokens ?? 0;
        this.stats.completionTokens += body.tokens?.completion_tokens ?? 0;
      })
      .catch((error) => {
        if (error.name === "AbortError") return;
        this.stats.failed++;
        this.error = error.message;
      })
      .finally(() => this.requests.delete(cycle));
  }

  /** The plan for `cycle` if it has arrived, taken once; older plans are dropped. */
  take(cycle) {
    const plan = this.plans.get(cycle) ?? null;
    for (const old of this.plans.keys())
      if (old <= cycle) this.plans.delete(old);
    return plan;
  }

  stop() {
    this.state = "stopped";
    for (const controller of this.requests.values()) controller.abort();
    this.requests.clear();
    this.plans.clear();
  }
}
