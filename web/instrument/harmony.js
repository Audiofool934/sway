// Generated harmony: the local server renders each bar's chord with MRT2, two bars
// ahead of the music, and the page starts that audio on its bar line. The engine still
// chooses every chord. A bar that has not arrived in time keeps the synthesized pad, so
// the music never waits for the model.

import { PAD } from "./band.js";

// Palettes and their short names; the start card calls them "Generated strings" and so on.
export const PALETTES = { strings: "Strings", piano: "Piano", choir: "Choir" };
// MRT2 answers a chord change late, by an amount that depends on the sound: measured
// at about 100 ms for strings and choir and 40 ms for piano. Each bar starts that early.
export const LEAD = { strings: 0.1, piano: 0.04, choir: 0.1 };
// The synthesized pad's loudness (RMS) per unit of its gain, as measured in the page.
// MRT2's own loudness varies from piece to piece, so the generated harmony is matched
// to this from the bars that arrive, rather than by a fixed gain.
const PAD_RMS = 0.109;
const MAX_GAIN = 30;
const JSON_HEADERS = { "Content-Type": "application/json" };

async function problem(response) {
  try {
    const { detail } = await response.json();
    if (typeof detail === "string") return detail;
  } catch {
    /* Not JSON. */
  }
  return `HTTP ${response.status}`;
}

/** RMS of 16-bit PCM, as a fraction of full scale. */
export function rootMeanSquare(pcm) {
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return pcm.length ? Math.sqrt(sum / pcm.length) / 32768 : 0;
}

/** Interleaved 16-bit PCM to an AudioBuffer. */
export function toBuffer(ctx, pcm, channels, sampleRate) {
  const frames = pcm.length / channels;
  const buffer = ctx.createBuffer(channels, frames, sampleRate);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < frames; i++) data[i] = pcm[i * channels + c] / 32768;
  }
  return buffer;
}

export class GeneratedHarmony {
  constructor(
    ctx,
    destination,
    {
      palette = "strings",
      world,
      fetch = (...args) => globalThis.fetch(...args),
    } = {},
  ) {
    this.ctx = ctx;
    this.palette = palette;
    this.world = world;
    this.fetch = fetch;
    this.lead = LEAD[palette];
    this.seed = 0; // Set by start(); the server renders only the latest piece's bars.
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.filter.connect(this.bus).connect(destination);
    this.barSeconds = (world.beatsPerBar * 60) / world.tempo;
    this.buffers = new Map(); // Bar to audio, until that bar is scheduled.
    this.requests = new Map(); // Bar to its AbortController while it renders.
    this.asked = new Set(); // Bars already requested, until their bar line passes.
    this.state = "idle"; // idle, starting, ready, failed, stopped
    this.error = null;
    this.last = null; // Whether the latest bar was "generated" or a "fallback".
    this.loudness = null; // Running RMS of the bars that have arrived.
    this.stats = {
      requested: 0,
      rendered: 0,
      played: 0,
      missed: 0,
      renderMs: [],
      roundTripMs: [],
    };
  }

  get active() {
    return this.state !== "failed" && this.state !== "stopped";
  }

  /** A fresh model stream for this piece; bars requested meanwhile render after it. */
  async start(seed = Math.floor(Math.random() * 2 ** 31)) {
    this.state = "starting";
    this.seed = seed;
    try {
      const response = await this.fetch("/api/harmony/start", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ palette: this.palette, seed }),
      });
      if (!response.ok) throw new Error(await problem(response));
      if (this.state === "starting") this.state = "ready";
    } catch (error) {
      if (this.state !== "stopped") {
        this.state = "failed";
        this.error = error.message;
      }
    }
  }

  /** Asks for one bar's chord; its audio waits here until that bar is scheduled. */
  request(bar, chord) {
    // Each bar renders once, even after its audio has been placed.
    if (!this.active || this.asked.has(bar)) return;
    this.asked.add(bar);
    const controller = new AbortController();
    this.requests.set(bar, controller);
    this.stats.requested++;
    const sent = performance.now();
    this.fetch("/api/harmony/bar", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        bar,
        voicing: chord.pad,
        tones: chord.tones,
        palette: this.palette,
        stream: this.seed,
        tempo: this.world.tempo,
        beats_per_bar: this.world.beatsPerBar,
      }),
      signal: controller.signal,
    })
      .then(async (response) => {
        // The server moved on to a newer piece; this bar is no longer wanted.
        if (response.status === 409) return;
        if (!response.ok) {
          // Without MRT2 no later bar can succeed either.
          if (response.status === 503) this.state = "failed";
          throw new Error(await problem(response));
        }
        const channels = Number(response.headers.get("X-Channels"));
        const rate = Number(response.headers.get("X-Sample-Rate"));
        const pcm = new Int16Array(await response.arrayBuffer());
        const frames = pcm.length / channels;
        // Only a whole bar can join its neighbours seamlessly.
        if (
          !(channels >= 1 && channels <= 2 && rate > 0) ||
          !Number.isInteger(frames) ||
          Math.abs(frames / rate - this.barSeconds) > 0.001
        )
          throw new Error("The generated bar has the wrong length");
        if (!this.active) return;
        this.buffers.set(bar, toBuffer(this.ctx, pcm, channels, rate));
        const rms = rootMeanSquare(pcm);
        this.loudness =
          this.loudness === null
            ? rms
            : this.loudness + 0.3 * (rms - this.loudness);
        this.stats.rendered++;
        this.#record(
          this.stats.renderMs,
          Number(response.headers.get("X-Render-Ms")),
        );
        this.#record(this.stats.roundTripMs, performance.now() - sent);
      })
      .catch((error) => {
        if (error.name !== "AbortError") this.error = error.message;
      })
      .finally(() => this.requests.delete(bar));
  }

  #record(list, value) {
    if (!Number.isFinite(value)) return;
    list.push(value);
    if (list.length > 60) list.shift();
  }

  /** Whether `bar` has arrived and can still be played. */
  ready(bar) {
    return this.active && this.buffers.has(bar);
  }

  /**
   * Starts `bar` so that its chord change lands on the bar line at `time`, and returns a
   * handle to release it early. The caller checks `ready(bar)` first and leaves enough
   * time before `time - this.lead` for the bar to start cleanly.
   */
  play(bar, time) {
    const buffer = this.buffers.get(bar);
    if (!buffer || !this.active) return null;
    this.buffers.delete(bar);
    const { ctx } = this;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const amp = ctx.createGain();
    source.connect(amp).connect(this.filter);
    const start = time - this.lead;
    source.start(start);
    let released = false;
    return {
      release: (at) => {
        if (released) return;
        released = true;
        if (at <= start) amp.gain.setValueAtTime(0, at);
        else amp.gain.setTargetAtTime(0, at, 0.08);
        source.stop(Math.max(at, start) + 0.6);
      },
    };
  }

  /** A bar line passed: count whether its harmony was generated or synthesized. */
  passed(bar, generated) {
    if (generated) this.stats.played++;
    else this.stats.missed++;
    this.last = generated ? "generated" : "fallback";
    for (const old of this.buffers.keys())
      if (old <= bar) this.buffers.delete(old);
    for (const old of this.asked) if (old <= bar) this.asked.delete(old);
  }

  /** Follows the band's energy at bar lines, as the synthesized pad does. */
  setLevel(level, time) {
    const loudness = Math.max(this.loudness ?? 0.01, PAD_RMS / MAX_GAIN);
    const gain = (PAD_RMS * PAD.gain[level]) / loudness;
    this.bus.gain.setTargetAtTime(gain, time, 0.25);
    this.filter.frequency.setTargetAtTime(
      1200 + 9000 * PAD.brightness[level],
      time,
      0.25,
    );
  }

  stop() {
    if (this.state === "stopped") return;
    this.state = "stopped";
    for (const controller of this.requests.values()) controller.abort();
    this.requests.clear();
    this.buffers.clear();
    // Released bars fade within a second; then this piece's nodes leave the graph.
    const timer = setTimeout(() => this.bus.disconnect(), 2000);
    timer.unref?.();
  }
}
