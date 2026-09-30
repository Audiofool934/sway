// Hand features to instrument events. Camera, pointer, and scripted input all pass
// the same per-role features ({ x, y, pinch, fist }), so every source plays alike.
// Event times are the best estimate of when the gesture happened, in seconds.

import { clamp } from "./theory.js";

export const TIMING = {
  hysteresis: 0.22, // Fraction of a rung or level to cross before changing.
  leadGrace: 0.15, // A lost lead hand releases its note after this long.
  levelSettle: 0.15, // Energy must rest at a new level this long to count.
  shapeHold: 0.1, // A fist must hold this long to cut the band.
  // Capturing is deliberate: a held pinch, so finger movement cannot loop by accident.
  captureHold: 0.6,
  captureCooldown: 1.5,
  afterFist: 0.3, // Opening a fist passes through a pinch; that is not a capture.
  bandGrace: 1, // A lost band hand releases a cut after this long.
  endHold: 0.8, // Two fists held this long end the piece.
  settleAfterShape: 0.2, // Height is ignored briefly after a fist or pinch.
};

// Continuous position to a step, changing only when clearly past the boundary.
export function stepWithHysteresis(position, steps, current, margin) {
  const scaled = clamp(position) * steps;
  if (current === null || current === undefined)
    return Math.min(steps - 1, Math.floor(scaled));
  if (scaled >= current - margin && scaled < current + 1 + margin)
    return current;
  return Math.min(steps - 1, Math.max(0, Math.floor(scaled)));
}

export class Controls {
  constructor({
    rungs = 10,
    levels = 5,
    range = { top: 0.14, bottom: 0.86 },
  } = {}) {
    this.rungs = rungs;
    this.levels = levels;
    this.range = { ...range };
    this.lead = {
      visible: false,
      height: null,
      rung: null,
      gate: false,
      seenAt: -Infinity,
    };
    this.band = {
      visible: false,
      height: null,
      level: null,
      candidate: null,
      candidateSince: 0,
      fist: false,
      fistSince: null,
      openSince: null,
      pinchSince: null,
      captured: false,
      capturedAt: -Infinity,
      fistAt: -Infinity,
      shapeUntil: -Infinity,
      cut: false,
      seenAt: -Infinity,
    };
    this.endSince = null;
    this.ended = false;
    this.lastTime = 0;
  }

  height(y) {
    const { top, bottom } = this.range;
    return clamp((bottom - y) / (bottom - top));
  }

  update(hands, time) {
    this.lastTime = time;
    const events = [];
    this.#lead(hands.lead, time, events);
    this.#band(hands.band, time, events);
    this.#ending(hands, time, events);
    return events;
  }

  #lead(hand, time, events) {
    const lead = this.lead;
    lead.visible = Boolean(hand);
    if (!hand) {
      if (lead.gate && time - lead.seenAt > TIMING.leadGrace) {
        lead.gate = false;
        events.push({ type: "noteOff", time: lead.seenAt });
      }
      return;
    }
    lead.seenAt = time;
    lead.height = this.height(hand.y);
    const rung = stepWithHysteresis(
      lead.height,
      this.rungs,
      lead.rung,
      TIMING.hysteresis,
    );
    const gate = Boolean(hand.pinch) && !hand.fist;
    if (gate && !lead.gate) events.push({ type: "noteOn", rung, time });
    else if (gate && rung !== lead.rung)
      events.push({ type: "noteMove", rung, time });
    else if (!gate && lead.gate) events.push({ type: "noteOff", time });
    lead.rung = rung;
    lead.gate = gate;
  }

  #band(hand, time, events) {
    const band = this.band;
    band.visible = Boolean(hand);
    if (!hand) {
      if (band.cut && time - band.seenAt > TIMING.bandGrace) {
        band.cut = false;
        events.push({ type: "cut", on: false, time });
      }
      band.fistSince = band.pinchSince = null;
      return;
    }
    band.seenAt = time;
    const fist = Boolean(hand.fist);
    const pinch = Boolean(hand.pinch) && !fist;

    // Fist cuts the band; opening the hand brings it back.
    if (fist) {
      band.fistAt = time;
      band.openSince = null;
      band.fistSince ??= time;
      band.shapeUntil = time + TIMING.settleAfterShape;
      if (!band.cut && time - band.fistSince >= TIMING.shapeHold) {
        band.cut = true;
        events.push({ type: "cut", on: true, time: band.fistSince });
      }
    } else {
      band.fistSince = null;
      band.openSince ??= time;
      if (band.cut && time - band.openSince >= TIMING.shapeHold) {
        band.cut = false;
        events.push({ type: "cut", on: false, time: band.openSince });
      }
    }
    band.fist = fist;

    // A pinch held steady captures once; releasing re-arms it.
    if (pinch) band.shapeUntil = time + TIMING.settleAfterShape;
    if (pinch && time - band.fistAt > TIMING.afterFist) {
      band.pinchSince ??= time;
      const held = time - band.pinchSince >= TIMING.captureHold;
      if (
        held &&
        !band.captured &&
        time - band.capturedAt >= TIMING.captureCooldown
      ) {
        band.captured = true;
        band.capturedAt = time;
        events.push({ type: "capture", time });
      }
    } else {
      band.pinchSince = null;
      band.captured = false;
    }

    // Height sets energy, ignored while the hand is making or leaving a shape.
    band.height = this.height(hand.y);
    if (time < band.shapeUntil) return;
    const level = stepWithHysteresis(
      band.height,
      this.levels,
      band.candidate ?? band.level,
      TIMING.hysteresis,
    );
    if (level !== band.candidate) {
      band.candidate = level;
      band.candidateSince = time;
    }
    if (
      level !== band.level &&
      time - band.candidateSince >= TIMING.levelSettle
    ) {
      band.level = level;
      events.push({ type: "energy", level, time });
    }
  }

  #ending(hands, time, events) {
    const both = hands.lead?.fist && hands.band?.fist;
    if (!both) {
      this.endSince = null;
      return;
    }
    this.endSince ??= time;
    if (!this.ended && time - this.endSince >= TIMING.endHold) {
      this.ended = true;
      events.push({ type: "end", time });
    }
  }

  /** How far a capture hold has progressed, from 0 to 1, for the band cursor. */
  get captureProgress() {
    const { pinchSince, captured } = this.band;
    if (pinchSince === null || captured) return 0;
    return Math.min(1, (this.lastTime - pinchSince) / TIMING.captureHold);
  }

  get endProgress() {
    return this.endSince === null || this.ended
      ? 0
      : (this.lastTime - this.endSince) / TIMING.endHold;
  }

  reset() {
    Object.assign(
      this,
      new Controls({
        rungs: this.rungs,
        levels: this.levels,
        range: this.range,
      }),
    );
  }
}
