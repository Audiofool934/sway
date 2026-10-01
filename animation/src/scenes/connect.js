// 8. Connect. A 16-step drum machine is programmed by a pointing hand, row by row, while a
// playhead (the Line) ticks across its grid with Sway's light swing. Then a MIDI cable carries
// "which note, how hard" from a keyboard to a synth, and a sampler turns a recording into pads.

import { applySwing, removeSwing } from "../../../web/instrument/clock.js";
import {
  FONT,
  PALETTE,
  fillCircle,
  lineSeg,
  paper,
  paperCircle,
  paperRect,
  rgba,
  rrectPath,
  text,
} from "../core/draw.js";
import { clamp, lerp, outBack, outCubic, seg, smooth } from "../core/ease.js";
import { drawHand, place, pose } from "../core/hand.js";
import { straight } from "../core/line.js";
import { cable } from "../core/props.js";
import { cues, motif } from "../score.js";
import { BEAT, atBar, byId } from "../timeline.js";

const C = byId.connect;
const BG = "#24252f";
const CREAM = "#f1ecdf";
const SKIN = "#f0c7a0";
const SWING = 0.56;
const GROUPS = ["#e5483a", "#f08a2c", "#f4c430", "#efe9da"];

const ROWS = Object.entries(cues.connect.rows).map(([name, row], index) => ({
  name,
  index,
  from: row.from,
  steps: [...row.pattern]
    .map((c, step) => (c === "x" ? step : -1))
    .filter((s) => s >= 0),
  label: {
    kick: "KICK",
    snare: "SNARE",
    hat: "HAT",
    open: "OPEN HAT",
    cow: "COWBELL",
    chop: "CHOP",
  }[name],
}));
const barLocal = (bar) => atBar(bar) - C.start;
const stepLocal = (bar, step) =>
  applySwing(bar * 4 + step / 4, SWING) * BEAT - C.start;

// ---- the grid
const GRID = { x: 150, y: 138, w: 1620, h: 330, label: 150, rowH: 44 };
const COL_W = (GRID.w - GRID.label - 30) / 16;
const colX = (step) => GRID.x + GRID.label + 14 + step * COL_W + COL_W / 2;
const rowY = (index) => GRID.y + 70 + index * GRID.rowH;

/** The step the playhead is on at local time t, as { bar, step, pos } (pos 0 to 16 across the bar). */
function playhead(t) {
  const beat = removeSwing((C.start + t) / BEAT, SWING);
  const bar = Math.floor(beat / 4);
  const pos = (beat - bar * 4) * 4;
  return { bar, step: Math.min(15, Math.floor(pos)), pos };
}

function lineAt(t) {
  const { pos } = playhead(t);
  // The playhead jumps to each column: the Line, standing upright.
  const x = colX(Math.floor(pos));
  return straight(x, GRID.y + 44, x, GRID.y + GRID.h - 12);
}

// ---- programming events: each row's buttons are pressed in a burst just before its bar
const PRESS = [];
for (const row of ROWS)
  row.steps.forEach((step, k) => {
    const at = barLocal(row.from) - 0.95 + k * 0.075;
    PRESS.push({
      row: row.index,
      step,
      t: at,
      x: colX(step),
      y: rowY(row.index),
    });
  });
PRESS.sort((a, b) => a.t - b.t);
const programmed = PRESS.filter((p) => p.t >= 0.4);
const buttonOn = (row, step, t) => {
  const p = PRESS.find((q) => q.row === row && q.step === step);
  return p ? outBack(seg(t, p.t, p.t + 0.25), 2.4) : 0;
};

function drawGrid(ctx, t) {
  const come = outCubic(seg(t, 0, 0.9));
  const { bar, pos } = playhead(t);
  // A small pulse on every kick.
  let kick = 0;
  for (const s of ROWS[0].steps) {
    const age = t - stepLocal(bar, s);
    if (age >= 0 && age < 0.25) kick = Math.max(kick, 1 - age / 0.25);
  }
  ctx.save();
  ctx.translate(GRID.x + GRID.w / 2, GRID.y + GRID.h / 2);
  const s = 1 + 0.006 * kick;
  ctx.scale(s, s);
  ctx.translate(-(GRID.x + GRID.w / 2), -(GRID.y + GRID.h / 2));
  ctx.translate(0, (1 - come) * -200);
  paperRect(ctx, GRID.x, GRID.y, GRID.w, GRID.h, 18, "#14151b", {
    dx: 6,
    dy: 12,
  });
  paperRect(ctx, GRID.x + 8, GRID.y + 8, GRID.w - 16, 28, 8, "#1d1f27", {
    shadow: false,
  });
  text(ctx, "RHYTHM COMPOSER", GRID.x + 28, GRID.y + 29, {
    font: `600 14px ${FONT.mono}`,
    color: CREAM,
    tracking: 4,
    opacity: 0.7,
  });
  text(ctx, "ROLAND TR-808  ·  1980", GRID.x + GRID.w - 28, GRID.y + 29, {
    font: `600 14px ${FONT.mono}`,
    color: "#f08a2c",
    align: "right",
    tracking: 3,
  });
  // Step numbers and LEDs.
  for (let step = 0; step < 16; step++) {
    const lit = Math.floor(pos) === step;
    fillCircle(ctx, colX(step), GRID.y + 58, 5, lit ? "#ff5b3a" : "#3a2423");
    if (step % 4 === 0)
      text(ctx, String(step + 1), colX(step), GRID.y + GRID.h - 14, {
        font: `500 13px ${FONT.mono}`,
        color: CREAM,
        align: "center",
        opacity: 0.45,
      });
  }
  ROWS.forEach((row) => {
    const y = rowY(row.index);
    const live = bar >= row.from;
    text(ctx, row.label, GRID.x + 28, y + 6, {
      font: `600 14px ${FONT.mono}`,
      color: CREAM,
      tracking: 2,
      opacity: live ? 0.9 : 0.45,
    });
    for (let step = 0; step < 16; step++) {
      const x = colX(step);
      const on = row.steps.includes(step) ? buttonOn(row.index, step, t) : 0;
      const group = GROUPS[Math.floor(step / 4)];
      const hit =
        on > 0.5 && live
          ? Math.max(0, 1 - (t - stepLocal(bar, step)) / 0.16) *
            (t >= stepLocal(bar, step) ? 1 : 0)
          : 0;
      const press = on > 0 && on < 1 ? 3 * (1 - on) : 0;
      paper(
        ctx,
        (c) =>
          rrectPath(c, x - COL_W * 0.4, y - 16 + press, COL_W * 0.8, 32, 6),
        on > 0.05 ? (hit > 0 ? "#ffffff" : group) : "#33343e",
        { dx: 2, dy: 4, alpha: 0.35 },
      );
      if (on > 0.05) {
        ctx.save();
        ctx.fillStyle = rgba("#ffffff", 0.22);
        ctx.beginPath();
        ctx.roundRect(
          x - COL_W * 0.4 + 4,
          y - 14 + press,
          COL_W * 0.8 - 8,
          8,
          4,
        );
        ctx.fill();
        ctx.restore();
      }
      if (hit > 0) {
        ctx.strokeStyle = rgba(group, hit * 0.8);
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.roundRect(
          x - COL_W * 0.4 - 4 - 6 * (1 - hit),
          y - 20 - 6 * (1 - hit),
          COL_W * 0.8 + 8 + 12 * (1 - hit),
          40 + 12 * (1 - hit),
          9,
        );
        ctx.stroke();
      }
    }
  });
  ctx.restore();
}

function drawProgrammer(ctx, t) {
  if (!programmed.length) return;
  const last = programmed.at(-1);
  const first = programmed[0];
  if (t < first.t - 0.9 || t > last.t + 1.6) return;
  let current = programmed[0];
  let previous = null;
  for (let i = 0; i < programmed.length; i++)
    if (programmed[i].t <= t) {
      current = programmed[i];
      previous = programmed[i - 1] ?? null;
    }
  const travel = outCubic(clamp((t - current.t + 0.1) / 0.18));
  const x = previous ? lerp(previous.x, current.x, travel) : current.x;
  let y = previous ? lerp(previous.y, current.y, travel) : current.y;
  const arrive = outCubic(seg(t, first.t - 0.9, first.t - 0.1));
  const leave = outCubic(seg(t, last.t + 0.5, last.t + 1.5));
  // A tap: the finger dips onto each button as it is pressed.
  const tap = Math.exp(-0.5 * ((t - current.t) * 12) ** 2) * 10;
  y += tap - (1 - arrive) * 280 + leave * 320;
  const scale = 94;
  const hand = pose("point");
  const probe = place(hand, { x: 0, y: 0, scale });
  const tip = probe[8];
  ctx.save();
  drawHand(ctx, hand, {
    x: x - tip[0] + 6,
    y: y - tip[1] + 20,
    scale,
    fill: SKIN,
    forearm: 3.0,
    sleeve: "#8b3a2a",
  });
  ctx.restore();
}

// ---- MIDI and sampler
const MELODY = motif(52).map((n) => ({
  t: n.t - C.start,
  dur: n.dur,
  midi: n.midi,
}));
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (m) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
const hex = (n) => n.toString(16).toUpperCase().padStart(2, "0");

function drawMidi(ctx, t) {
  const come = outBack(seg(t, 9.0, 10.0), 1.4);
  if (come <= 0) return;
  const whites = [67, 69, 71, 72, 74, 76];
  const blacks = [
    [68, 0],
    [70, 1],
    [73, 3],
    [75, 4],
  ];
  const x0 = 190;
  const KW = 54;
  const top = 596;
  ctx.save();
  ctx.translate(0, (1 - clamp(come, 0, 1.15)) * 260 - 22);
  ctx.globalAlpha = smooth(seg(t, 9.0, 9.6));
  paperRect(ctx, 150, 530, 780, 270, 18, "#14151b", { dx: 5, dy: 10 });
  const active = MELODY.find((n) => t >= n.t && t < n.t + n.dur * 0.9);
  whites.forEach((m, i) =>
    paper(
      ctx,
      (c) =>
        c.rect(
          x0 + i * KW + 2,
          top + (active?.midi === m ? 6 : 0),
          KW - 4,
          104,
        ),
      active?.midi === m ? "#ff9b7f" : "#fbf7ea",
      { dx: 2, dy: 4, alpha: 0.25 },
    ),
  );
  blacks.forEach(([m, i]) =>
    paper(
      ctx,
      (c) => c.rect(x0 + (i + 1) * KW - 14, top, 28, 62),
      active?.midi === m ? "#ff5b3a" : "#1d1b2e",
      { dx: 2, dy: 4, alpha: 0.35 },
    ),
  );
  // The cable, the synth, and the message in between.
  const a = [x0 + 6 * KW + 14, 650];
  const b = [722, 650];
  cable(ctx, a[0], a[1], b[0], b[1], "#b184d1", { sag: 62, width: 9 });
  paperCircle(ctx, a[0], a[1], 12, "#0f1014", { dx: 2, dy: 3 });
  paperRect(ctx, 722, 590, 176, 150, 12, "#2a2c36", { dx: 3, dy: 6 });
  paperRect(ctx, 738, 606, 144, 54, 8, "#0d1b22", { shadow: false });
  paperCircle(ctx, b[0] + 2, b[1], 12, "#0f1014", { shadow: false });
  for (const n of MELODY) {
    const age = t - n.t;
    if (age < 0 || age > 0.42) continue;
    const u = clamp(age / 0.32);
    const mx = lerp(
      lerp(a[0], (a[0] + b[0]) / 2, u),
      lerp((a[0] + b[0]) / 2, b[0], u),
      u,
    );
    const my = lerp(
      lerp(a[1], 650 + 62 * 1.15, u),
      lerp(650 + 62 * 1.15, b[1], u),
      u,
    );
    ctx.save();
    ctx.translate(mx, my - 6);
    ctx.globalAlpha = 1 - smooth(seg(age, 0.3, 0.42));
    paperRect(ctx, -52, -16, 104, 32, 8, "#fbf3dc", { dx: 2, dy: 4 });
    text(ctx, `${hex(0x90)} ${hex(n.midi)} ${hex(100)}`, 0, 6, {
      font: `600 15px ${FONT.mono}`,
      color: "#2a1e14",
      align: "center",
      tracking: 1,
    });
    ctx.restore();
  }
  const last = [...MELODY].reverse().find((n) => t >= n.t);
  if (last) {
    const flash = Math.max(0, 1 - (t - last.t) / 0.4);
    text(ctx, noteName(last.midi), 810, 646, {
      font: `600 38px ${FONT.mono}`,
      color: rgba("#6fd2c4", 0.6 + 0.4 * flash),
      align: "center",
    });
    text(ctx, "NOTE ON", 810, 724, {
      font: `600 14px ${FONT.mono}`,
      color: CREAM,
      align: "center",
      tracking: 2,
      opacity: 0.8,
    });
  }
  text(ctx, "MIDI  ·  1983", 190, 782, {
    font: `600 15px ${FONT.mono}`,
    color: "#b184d1",
    tracking: 4,
  });
  text(ctx, "which note, how hard", 380, 782, {
    font: `italic 500 20px ${FONT.serif}`,
    color: CREAM,
    opacity: 0.85,
  });
  ctx.restore();
}

/** The sample: a piano chord's decaying waveform, sliced into four pieces for four pads. */
const CHOP = ROWS.find((r) => r.name === "chop");
const recording = (u) =>
  Math.exp(-u * 3.2) *
  (0.35 + 0.65 * Math.abs(Math.sin(u * 40))) *
  Math.sin(u * 400 + Math.sin(u * 30) * 2);
function drawSampler(ctx, t) {
  const come = outBack(seg(t, 9.2, 10.2), 1.4);
  if (come <= 0) return;
  const px = 980;
  ctx.save();
  ctx.translate(0, (1 - clamp(come, 0, 1.15)) * 260 - 22);
  ctx.globalAlpha = smooth(seg(t, 9.2, 9.8));
  paperRect(ctx, px, 530, 790, 270, 18, "#14151b", { dx: 5, dy: 10 });
  // The recording, with slice markers.
  const wx0 = px + 30;
  const ww = 730;
  const cy = 590;
  ctx.strokeStyle = "#6fd2c4";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let k = 0; k <= 360; k++) {
    const u = k / 360;
    k
      ? ctx.lineTo(wx0 + u * ww, cy + recording(u) * 26)
      : ctx.moveTo(wx0 + u * ww, cy + recording(u) * 26);
  }
  ctx.stroke();
  const { bar } = playhead(t);
  const hits = CHOP.steps;
  hits.forEach((_, k) =>
    lineSeg(
      ctx,
      wx0 + (k / 4) * ww,
      556,
      wx0 + (k / 4) * ww,
      624,
      "#f4ead2",
      1.5,
      { opacity: 0.5 },
    ),
  );
  // Four pads, lighting as the chops are struck.
  const names = ["A", "F", "C", "G"];
  const chordIndex = ((bar % 4) + 4) % 4;
  hits.forEach((step, k) => {
    const x = px + 40 + k * 178;
    const age = t - stepLocal(bar, step);
    const hit = age >= 0 && age < 0.3 && bar >= CHOP.from ? 1 - age / 0.3 : 0;
    paper(
      ctx,
      (c) => rrectPath(c, x, 648, 160, 104, 12),
      hit > 0 ? mix2("#3a3b45", "#f4c430", hit) : "#33343e",
      { dx: 3, dy: 6, alpha: 0.35 },
    );
    const ink = hit > 0.2 ? "#1d1b2e" : CREAM;
    text(ctx, `PAD ${k + 1}`, x + 16, 676, {
      font: `600 14px ${FONT.mono}`,
      color: ink,
      tracking: 2,
      opacity: 0.8,
    });
    // The slice this pad plays, and the note it is pitched to.
    ctx.strokeStyle = hit > 0.2 ? "#1d1b2e" : "#6fd2c4";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let j = 0; j <= 90; j++) {
      const u = (k + j / 90) / 4;
      const px2 = x + 16 + (j / 90) * 128;
      j
        ? ctx.lineTo(px2, 718 + recording(u) * 17)
        : ctx.moveTo(px2, 718 + recording(u) * 17);
    }
    ctx.stroke();
    text(ctx, names[chordIndex], x + 144, 676, {
      font: `italic 600 24px ${FONT.serif}`,
      color: ink,
      align: "right",
      opacity: 0.9,
    });
    if (hit > 0)
      lineSeg(
        ctx,
        wx0 + (k / 4) * ww,
        556,
        wx0 + ((k + 1) / 4) * ww,
        556,
        "#f4c430",
        5,
        { opacity: hit },
      );
  });
  text(ctx, "SAMPLER  ·  1988", px + 30, 782, {
    font: `600 15px ${FONT.mono}`,
    color: "#f4c430",
    tracking: 4,
  });
  text(ctx, "any sound, on a key", px + 250, 782, {
    font: `italic 500 20px ${FONT.serif}`,
    color: CREAM,
    opacity: 0.85,
  });
  ctx.restore();
}

function mix2(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(lerp(v, pb[i], t))).join(",")})`;
}

export default {
  bg: BG,
  ink: CREAM,
  lineColor: PALETTE.vermilion,
  captionAt: 2.0,
  ghostAlpha: 0.045,
  ghostY: 800,

  line: lineAt,
  lineStyle: (t) => ({ width: 6, opacity: smooth(seg(t, 0.05, 0.4)) * 0.9 }),

  back(ctx, t) {
    drawGrid(ctx, t);
    drawMidi(ctx, t);
    drawSampler(ctx, t);
    // The kit's label, before the other machines arrive.
    const label = (1 - smooth(seg(t, 8.8, 9.4))) * smooth(seg(t, 1.4, 2.0));
    if (label > 0)
      text(ctx, "a grid for time", 150, 540, {
        font: `italic 500 32px ${FONT.serif}`,
        color: CREAM,
        opacity: label * 0.75,
      });
  },

  front(ctx, t) {
    drawProgrammer(ctx, t);
  },
};
