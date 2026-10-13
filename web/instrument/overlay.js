// The instrument and light hand accents share the mirrored camera coordinates.
// Each hand has a timeline beside it:
// the future arrives from the centre, meets a "now" line near the hand, and
// leaves toward the edge. The lead side is the pitch ladder; the band side shows
// energy zones. Everything is positioned in the mirrored view's coordinates.

import { TYPICAL_VELOCITY, isChordTone, noteName } from "./theory.js";
import { HandVisuals } from "./hand-visual.js";

const COLORS = {
  lead: [255, 181, 71],
  band: [79, 209, 197],
  loop: [255, 214, 153],
  ink: [244, 241, 234],
  miss: [255, 128, 112],
};
const HIT = new Set(["perfect", "good"]);
const rgba = ([r, g, b], a = 1) => `rgba(${r},${g},${b},${a})`;
// Free play leaves room for the melody just played; lessons show more of what is coming.
export const VIEWS = {
  play: { future: 2, now: 0.34 },
  lesson: { future: 4, now: 0.55 },
};
const PAST_BEATS = 4;
// The centre of row `index` of `count` equal rows between top and bottom, counted upward.
const rowCentre = (index, count, top, bottom) =>
  bottom - ((index + 0.5) * (bottom - top)) / count;

export class Overlay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.size = { width: 0, height: 0, dpr: 1 };
    this.hands = new HandVisuals(COLORS);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { clientWidth: width, clientHeight: height } = this.canvas;
    if (
      width === this.size.width &&
      height === this.size.height &&
      dpr === this.size.dpr
    )
      return;
    this.size = { width, height, dpr };
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
  }

  /** Where view coordinates land on screen for a video shown with object-fit: cover. */
  #frame(aspect) {
    const { width, height } = this.size;
    const shown =
      width / height > aspect
        ? { w: width, h: width / aspect }
        : { w: height * aspect, h: height };
    return {
      x: (x) => (width - shown.w) / 2 + x * shown.w,
      y: (y) => (height - shown.h) / 2 + y * shown.h,
    };
  }

  draw(scene) {
    this.resize();
    const { ctx } = this;
    const { width, height, dpr } = this.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!scene) return;
    const view = this.#frame(scene.aspect);
    const top = view.y(scene.range.top);
    const bottom = view.y(scene.range.bottom);
    const leadRight = scene.leadSide === "Right";
    // Each timeline occupies one side; "now" sits partway out from the centre, further
    // out during lessons so that more of what is coming is visible.
    const timeline = VIEWS[scene.view] ?? VIEWS.play;
    const side = (right) => {
      const inner = right ? width * 0.53 : width * 0.47;
      const outer = right ? width - 28 : 28;
      const now = inner + (outer - inner) * timeline.now;
      const perBeat = Math.abs(now - inner) / timeline.future;
      const direction = right ? 1 : -1;
      // Future positions move from the centre toward "now"; the past continues outward.
      const x = (beat) => now - direction * (beat - scene.beat) * perBeat;
      return { inner, outer, now, x, direction };
    };
    const lead = side(leadRight);
    const band = side(!leadRight);
    this.#grid(scene, lead, top, bottom);
    this.#grid(scene, band, top, bottom);
    this.#ladder(scene, lead, top, bottom);
    this.#energy(scene, band, top, bottom);
    this.hands.draw(ctx, scene, view);
    this.#leadCursor(scene, lead, top, bottom, view);
    this.#bandCursor(scene, band, top, bottom, view);
    if (scene.endProgress > 0)
      this.#endRing(scene.endProgress, width / 2, height - 120);
  }

  // Beat lines scroll with the music; bar lines are stronger.
  #grid(scene, side, top, bottom) {
    const { ctx } = this;
    const from = Math.floor(scene.beat - PAST_BEATS);
    for (let beat = from; beat <= scene.beat + 9; beat++) {
      const x = side.x(beat);
      if (
        (x - side.inner) * side.direction < 0 ||
        (x - side.outer) * side.direction > 0
      )
        continue;
      const bar = beat % 4 === 0;
      ctx.strokeStyle = rgba(COLORS.ink, bar ? 0.16 : 0.06);
      ctx.lineWidth = bar ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }
    const pulse = 1 - (scene.beat - Math.floor(scene.beat));
    ctx.strokeStyle = rgba(COLORS.ink, 0.35 + 0.35 * pulse ** 3);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(side.now, top - 10);
    ctx.lineTo(side.now, bottom + 10);
    ctx.stroke();
  }

  #ladder(scene, side, top, bottom) {
    const { ctx } = this;
    const rungs = scene.ladder.length;
    const rowHeight = (bottom - top) / rungs;
    const rowY = (rung) => rowCentre(rung, rungs, top, bottom);
    const { hand, rung: current, gate } = scene.lead;
    const left = Math.min(side.inner, side.outer);
    const right = Math.max(side.inner, side.outer);

    // Rows: chord tones are brighter, and the hand's row is lit.
    for (let rung = 0; rung < rungs; rung++) {
      const y = rowY(rung);
      const chordTone =
        scene.chord && isChordTone(scene.ladder[rung], scene.chord);
      if (hand && rung === current) {
        ctx.fillStyle = rgba(COLORS.lead, gate ? 0.22 : 0.1);
        ctx.fillRect(left, y - rowHeight / 2, right - left, rowHeight);
      }
      ctx.strokeStyle = rgba(COLORS.ink, chordTone ? 0.3 : 0.12);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.font = `${chordTone ? 600 : 500} 13px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = side.direction > 0 ? "right" : "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = rgba(
        rung === current && hand ? COLORS.lead : COLORS.ink,
        chordTone || rung === current ? 0.95 : 0.45,
      );
      ctx.fillText(noteName(scene.ladder[rung]), side.outer, y);
    }

    // Loop notes as thin lines, then the melody as one continuous drawn line.
    ctx.save();
    ctx.beginPath();
    ctx.rect(
      left,
      top - rowHeight,
      right - left - 30,
      bottom - top + 2 * rowHeight,
    );
    ctx.clip();
    ctx.lineCap = "round";
    const stroke = (start, end, rung, color, alpha, lineWidth) => {
      ctx.strokeStyle = rgba(color, alpha);
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(side.x(start), rowY(rung));
      ctx.lineTo(side.x(end), rowY(rung));
      ctx.stroke();
    };
    for (const note of scene.loopNotes)
      stroke(
        note.beat,
        note.beat + note.beats,
        note.rung,
        COLORS.loop,
        0.45,
        3,
      );
    // Lesson targets: outlined notes that fill when hit and redden when missed.
    // A slide is joined to the note before it, as the melody trail joins legato notes.
    let before = null;
    for (const target of scene.targets ?? []) {
      if (target.kind !== "note" && target.kind !== "swell") continue;
      let x1 = side.x(target.beat),
        x2 = side.x(target.beat + target.beats);
      if (x1 > x2) [x1, x2] = [x2, x1];
      const height = rowHeight * 0.56;
      const y = rowY(target.rung) - height / 2;
      const grade = target.result?.grade;
      const soon = !grade && Math.abs(target.beat - scene.beat) < 1;
      ctx.lineWidth = 2;
      ctx.strokeStyle = HIT.has(grade)
        ? rgba(COLORS.lead, 0.9)
        : grade
          ? rgba(COLORS.miss, 0.55)
          : rgba(COLORS.ink, soon ? 0.95 : 0.6);
      if (target.legato && before) {
        const x = side.x(target.beat);
        ctx.beginPath();
        ctx.moveTo(x, rowY(before.rung));
        ctx.lineTo(x, rowY(target.rung));
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.roundRect(x1, y, Math.max(height, x2 - x1), height, height / 2);
      ctx.fillStyle = HIT.has(grade)
        ? rgba(COLORS.lead, 0.4)
        : rgba(COLORS.ink, soon ? 0.2 : 0.08);
      ctx.fill();
      ctx.stroke();
      const label =
        target.kind === "swell"
          ? target.value > 0
            ? "SWELL"
            : "SOFTEN"
          : target.expression?.toUpperCase();
      if (label) {
        ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = rgba(COLORS.ink, 0.95);
        ctx.fillText(label, (x1 + x2) / 2, y - 8);
      }
      if (target.kind === "note") before = target;
    }
    const thick = Math.max(5, rowHeight * 0.18);
    let previous = null;
    for (const note of scene.trail) {
      const end = note.end ?? scene.beat;
      const age = scene.beat - end;
      const alpha =
        note.end === null ? 1 : Math.max(0, 0.85 - age / (PAST_BEATS + 1));
      if (
        note.legato &&
        previous &&
        Math.abs(previous.end - note.start) < 0.01
      ) {
        ctx.strokeStyle = rgba(COLORS.lead, alpha);
        ctx.lineWidth = thick * 0.5;
        ctx.beginPath();
        ctx.moveTo(side.x(note.start), rowY(previous.rung));
        ctx.lineTo(side.x(note.start), rowY(note.rung));
        ctx.stroke();
      }
      // A note is drawn as thick as it was struck.
      const weight = (note.velocity ?? TYPICAL_VELOCITY) / TYPICAL_VELOCITY;
      stroke(note.start, end, note.rung, COLORS.lead, alpha, thick * weight);
      previous = { rung: note.rung, end };
    }
    ctx.restore();
  }

  #leadCursor(scene, side, top, bottom, view) {
    // The hand, joined to "now" on its row.
    const { ctx } = this;
    const { hand, rung: current, gate, swell = 0 } = scene.lead;
    if (!hand) return;
    const hx = view.x(hand.x);
    const hy = view.y(hand.y);
    const y = rowCentre(current, scene.ladder.length, top, bottom);
    ctx.strokeStyle = rgba(COLORS.lead, gate ? 0.9 : 0.45);
    ctx.lineWidth = gate ? 2.5 : 1.5;
    ctx.setLineDash(gate ? [] : [4, 6]);
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(side.now, y);
    ctx.stroke();
    ctx.setLineDash([]);
    this.#cursor(hx, hy, COLORS.lead, gate, false, Boolean(hand.landmarks));
    if (scene.leadHold > 0) this.#ring(hx, hy, 27, scene.leadHold, COLORS.lead);
    // The note's swell: a larger dot as the hand leans in, a smaller one as it leans back.
    ctx.fillStyle = rgba(COLORS.lead, 1);
    ctx.beginPath();
    ctx.arc(side.now, y, gate ? 7 * (1 + 0.45 * swell) : 4, 0, Math.PI * 2);
    ctx.fill();
  }

  #energy(scene, side, top, bottom) {
    const { ctx } = this;
    const levels = scene.levels.length;
    const zone = (bottom - top) / levels;
    const zoneY = (level) => rowCentre(level, levels, top, bottom);
    const left = Math.min(side.inner, side.outer);
    const right = Math.max(side.inner, side.outer);
    const { hand, level: handLevel } = scene.band;

    for (let level = 0; level < levels; level++) {
      const y = zoneY(level);
      const playing = level <= scene.level && !scene.cut;
      if (hand && level === handLevel) {
        ctx.fillStyle = rgba(COLORS.band, 0.1);
        ctx.fillRect(left, y - zone / 2, right - left, zone);
      }
      ctx.strokeStyle = rgba(COLORS.ink, 0.08);
      ctx.beginPath();
      ctx.moveTo(left, y - zone / 2);
      ctx.lineTo(right, y - zone / 2);
      ctx.stroke();
      ctx.font = `${playing ? 600 : 500} 12px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = side.direction > 0 ? "right" : "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = rgba(
        playing ? COLORS.band : COLORS.ink,
        playing ? 0.95 : 0.4,
      );
      ctx.fillText(scene.levels[level].toUpperCase(), side.outer, y);
    }

    // Energy over time: a line at each bar's level over a faint fill; cuts are gaps.
    ctx.fillStyle = rgba(COLORS.band, 0.07);
    ctx.strokeStyle = rgba(COLORS.band, 0.9);
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (const segment of scene.energy) {
      let x1 = side.x(segment.start),
        x2 = side.x(segment.end);
      if (x1 > x2) [x1, x2] = [x2, x1];
      x1 = Math.max(x1, left);
      x2 = Math.min(x2, right - 70);
      if (x2 <= x1 || segment.cut) continue;
      const y = bottom - (segment.level + 1) * zone;
      ctx.globalAlpha = segment.future ? 0.45 : 1;
      ctx.fillRect(x1, y, x2 - x1, bottom - y);
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Lesson targets for the band: the level to reach, and when to cut.
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top - 30, right - left - 70, bottom - top + 40);
    ctx.clip();
    for (const target of scene.targets ?? []) {
      if (target.kind !== "energy" && target.kind !== "cut") continue;
      const grade = target.result?.grade;
      const color = HIT.has(grade)
        ? COLORS.band
        : grade
          ? COLORS.miss
          : COLORS.ink;
      if (target.kind === "energy") {
        let x1 = side.x(target.beat),
          x2 = side.x(target.beat + 4);
        if (x1 > x2) [x1, x2] = [x2, x1];
        const y = zoneY(target.level) - zone / 2;
        ctx.setLineDash([6, 5]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = rgba(color, grade ? 0.8 : 0.7);
        ctx.strokeRect(x1, y + 3, x2 - x1, zone - 6);
        ctx.setLineDash([]);
        continue;
      }
      const x = side.x(target.beat);
      ctx.strokeStyle = rgba(color, 0.85);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = rgba(color, 0.95);
      ctx.fillText(target.on ? "CUT" : "BACK", x, top - 12);
    }
    ctx.restore();

    for (const mark of scene.captures) {
      const x = side.x(mark);
      if (x < left || x > right - 70) continue;
      ctx.fillStyle = rgba(COLORS.loop, 0.9);
      ctx.beginPath();
      ctx.arc(x, bottom + 16, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  #bandCursor(scene, side, top, bottom, view) {
    const { ctx } = this;
    const { hand, level: handLevel, cut } = scene.band;
    if (!hand) return;
    const hx = view.x(hand.x);
    const hy = view.y(hand.y);
    const y = rowCentre(
      handLevel ?? scene.level,
      scene.levels.length,
      top,
      bottom,
    );
    ctx.strokeStyle = rgba(COLORS.band, 0.55);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(side.now, y);
    ctx.stroke();
    ctx.setLineDash([]);
    this.#cursor(hx, hy, COLORS.band, hand.pinch, cut, Boolean(hand.landmarks));
    if (scene.captureProgress > 0)
      this.#ring(hx, hy, 27, scene.captureProgress, COLORS.loop);
  }

  #cursor(x, y, color, filled, crossed = false, tracked = false) {
    const { ctx } = this;
    ctx.fillStyle = rgba(color, filled ? 0.9 : 0.12);
    ctx.strokeStyle = rgba(color, 0.95);
    ctx.lineWidth = tracked ? 1.8 : 2.5;
    ctx.beginPath();
    ctx.arc(x, y, tracked ? 13 : 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (crossed) {
      ctx.beginPath();
      ctx.moveTo(x - 9, y - 9);
      ctx.lineTo(x + 9, y + 9);
      ctx.moveTo(x + 9, y - 9);
      ctx.lineTo(x - 9, y + 9);
      ctx.stroke();
    }
  }

  #ring(x, y, radius, progress, color) {
    const { ctx } = this;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.strokeStyle = rgba(color, 0.2);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = rgba(color, 0.95);
    ctx.beginPath();
    ctx.arc(
      x,
      y,
      radius,
      -Math.PI / 2,
      -Math.PI / 2 + Math.min(1, progress) * Math.PI * 2,
    );
    ctx.stroke();
  }

  #endRing(progress, x, y) {
    this.#ring(x, y, 30, progress, COLORS.ink);
  }
}
