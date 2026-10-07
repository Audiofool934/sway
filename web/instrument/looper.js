// Retrospective looping: the lead is always remembered, and a capture turns the last
// cycle into a layer. Each note keeps its pitch, velocity, and place in the cycle, and
// replays there from right after the capture. The chords may differ by then, since each
// cycle has its own plan, but every note is on the ladder, so the loop stays in key.

import { TYPICAL_VELOCITY } from "./theory.js";

export const MAX_LAYERS = 4;

export class Looper {
  constructor(cycle = 16) {
    this.cycle = cycle;
    this.history = [];
    this.layers = [];
    this.nextId = 1;
  }

  noteOn(pitch, beat, velocity = TYPICAL_VELOCITY) {
    this.noteOff(beat);
    this.history.push({ pitch, start: beat, end: null, velocity });
    // Two cycles of history is enough for any capture.
    const horizon = beat - 2 * this.cycle;
    while (this.history.length && (this.history[0].end ?? beat) < horizon)
      this.history.shift();
  }

  noteOff(beat) {
    const last = this.history.at(-1);
    if (last && last.end === null) last.end = Math.max(beat, last.start + 0.05);
  }

  /** Capture the cycle that ends at `beat`. Returns the new layer, or null if silent. */
  capture(beat) {
    const from = beat - this.cycle;
    const notes = this.history
      .filter((note) => note.start >= from && note.start < beat)
      .map((note) => ({
        pitch: note.pitch,
        velocity: note.velocity,
        position: ((note.start % this.cycle) + this.cycle) % this.cycle,
        beats: Math.min((note.end ?? beat) - note.start, this.cycle - 0.25),
      }));
    if (!notes.length) return null;
    const layer = { id: this.nextId++, notes, from: beat };
    this.layers.push(layer);
    if (this.layers.length > MAX_LAYERS) this.layers.shift();
    return layer;
  }

  undo() {
    return this.layers.pop() ?? null;
  }

  clear() {
    this.layers = [];
  }

  /** Loop notes that start in [start, end), each with its absolute start beat. */
  window(start, end) {
    const events = [];
    for (const layer of this.layers)
      for (const note of layer.notes) {
        let at =
          Math.ceil(
            (Math.max(start, layer.from) - note.position) / this.cycle - 1e-9,
          ) *
            this.cycle +
          note.position;
        for (; at < end; at += this.cycle)
          events.push({ layer: layer.id, beat: at, ...note });
      }
    return events.sort((a, b) => a.beat - b.beat);
  }
}
