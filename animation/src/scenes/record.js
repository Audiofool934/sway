// 4. Record. A phonograph traces the tune as a groove (the waveform itself); then tape:
// the same sound is cut, looped, reversed, and layered across eight tracks.

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
import {
  clamp,
  inOutCubic,
  lerp,
  outBack,
  outCubic,
  seg,
  smooth,
} from "../core/ease.js";
import { drawHand, pose } from "../core/hand.js";
import { fromFunction, morph, wave } from "../core/line.js";
import { reel } from "../core/props.js";
import { rng } from "../core/rand.js";
import { chordOfBar, motif } from "../score.js";
import { atBar, byId } from "../timeline.js";

const C = byId.record;
const BG = "#3c2a50";
const CREAM = "#f4ead2";
const SKIN = "#f0c7a0";
const BRASS = "#cf9d3d";

// The sound the groove carries: every note of the two statements, as decaying visual waves.
const EVENTS = (() => {
  const out = [];
  for (const start of [20, 24])
    for (const n of motif(start))
      out.push({ t: n.t - C.start, midi: n.midi, w: 1 });
  for (let bar = 20; bar < 28; bar++) {
    const ch = chordOfBar(bar);
    out.push(
      { t: atBar(bar, 0) - C.start, midi: ch.bass + 12, w: 0.7 },
      { t: atBar(bar, 2) - C.start, midi: ch.bass + 19, w: 0.6 },
    );
    for (const beat of [1, 3])
      for (const midi of ch.pad.slice(1))
        out.push({ t: atBar(bar, beat) - C.start, midi, w: 0.3 });
  }
  return out.sort((a, b) => a.t - b.t);
})();

/** The recorded signal at local time `tau`: a sum of ringing notes, in [-1, 1]. */
function waveAt(tau) {
  let sum = 0;
  for (const e of EVENTS) {
    const age = tau - e.t;
    if (age < 0) break;
    if (age > 1.8) continue;
    const fv = 5.2 * 2 ** ((e.midi - 60) / 12);
    sum +=
      e.w *
      Math.exp(-age / 0.55) *
      Math.min(1, age / 0.012) *
      Math.sin(2 * Math.PI * fv * age);
  }
  return Math.tanh(sum * 0.85);
}

// ---- phase A: phonograph
const CYL = { x: 560, y: 450, w: 800, h: 170 };
const GROOVE_Y = 535;
const STYLUS_X = 960;
const V = 260;
const PHASE_B = 9.6;
const TAPE_Y = 500;
const REELS = { left: [520, 360], right: [1400, 360], r: 118 };
const TAPE_X0 = 520;
const TAPE_X1 = 1400;

// ---- phase B beats
const SNIP = 12.9;
const LOOP_END = 14.4;
const REVERSE_END = 16.8;
const STOP = 18.5;

/**
 * Where the tape is, in recording time: forward, then backward for the reversal, then
 * forward again until the machine is switched off and the reels coast to a stop.
 */
function tapeTime(t) {
  if (t < LOOP_END) return t;
  if (t < REVERSE_END) return LOOP_END - (t - LOOP_END);
  const base = LOOP_END - (REVERSE_END - LOOP_END);
  const after = t - REVERSE_END;
  const coastAt = STOP - REVERSE_END;
  if (after <= coastAt) return base + after;
  const u = clamp((after - coastAt) / 0.7);
  return base + coastAt + (0.7 / 2.7) * (1 - (1 - u) ** 2.7);
}

function grooveLine(t) {
  return wave(
    CYL.x,
    CYL.x + CYL.w,
    (u, x) => GROOVE_Y - 62 * waveAt(t + (x - STYLUS_X) / V),
  );
}
function tapeStraight(t) {
  const rt = tapeTime(t);
  return wave(
    TAPE_X0,
    TAPE_X1,
    (u, x) => TAPE_Y - 34 * waveAt(rt + (x - 960) / V),
  );
}
/** The cut tape formed into a loop: a ring hanging under the head. */
function loopLine(t) {
  const rt = tapeTime(t);
  const cx = 960;
  const cy = 470;
  const R = 150;
  return fromFunction((u) => {
    const a = u * Math.PI * 2 - Math.PI / 2;
    const r = R - 26 * waveAt(rt + u * 2.4);
    return [cx + Math.cos(a) * r * 1.35, cy + Math.sin(a) * r * 0.78];
  });
}

const dust = (() => {
  const r = rng(8);
  return Array.from({ length: 70 }, () => ({
    x: r() * 1920,
    y: r() * 1080,
    s: 1 + r() * 2.5,
    seed: r(),
  }));
})();

function horn(ctx, t, alpha) {
  const throat = [STYLUS_X, 378];
  ctx.save();
  ctx.globalAlpha *= alpha;
  const g = ctx.createLinearGradient(300, 80, 900, 380);
  g.addColorStop(0, "#f0c969");
  g.addColorStop(0.5, "#cf9d3d");
  g.addColorStop(1, "#8f6a22");
  paper(
    ctx,
    (c) => {
      c.moveTo(throat[0] - 22, throat[1] - 12);
      c.quadraticCurveTo(620, 290, 330, 60);
      c.quadraticCurveTo(210, 190, 330, 330);
      c.quadraticCurveTo(640, 410, throat[0] + 22, throat[1] + 14);
      c.closePath();
    },
    g,
    { dx: 7, dy: 11 },
  );
  paper(
    ctx,
    (c) => c.ellipse(330, 195, 62, 140, 0.18, 0, Math.PI * 2),
    "#5a3b17",
    { shadow: false },
  );
  paper(
    ctx,
    (c) => c.ellipse(335, 196, 40, 112, 0.18, 0, Math.PI * 2),
    "#2a1a0a",
    { shadow: false },
  );
  ctx.restore();
}

function phonograph(ctx, t, alpha) {
  const spin = (t * 90) % 40;
  ctx.save();
  ctx.globalAlpha *= alpha;
  // The wax cylinder.
  const g = ctx.createLinearGradient(0, CYL.y, 0, CYL.y + CYL.h);
  g.addColorStop(0, "#9a6c48");
  g.addColorStop(0.4, "#6e4a30");
  g.addColorStop(1, "#33200f");
  paper(ctx, (c) => rrectPath(c, CYL.x, CYL.y, CYL.w, CYL.h, 22), g, {
    dx: 6,
    dy: 10,
  });
  paper(
    ctx,
    (c) =>
      c.ellipse(CYL.x + 4, CYL.y + CYL.h / 2, 24, CYL.h / 2, 0, 0, Math.PI * 2),
    "#4a2f1c",
    { shadow: false },
  );
  ctx.save();
  ctx.beginPath();
  rrectPath(ctx, CYL.x + 24, CYL.y, CYL.w - 30, CYL.h, 18);
  ctx.clip();
  for (let k = -1; k < 6; k++)
    lineSeg(
      ctx,
      CYL.x,
      CYL.y + k * 40 + spin,
      CYL.x + CYL.w,
      CYL.y + k * 40 + spin,
      "#1d1209",
      2,
      { opacity: 0.18 },
    );
  ctx.restore();
  // The base.
  paperRect(ctx, 470, 630, 980, 64, 14, "#8a5a35");
  paperRect(ctx, 470, 630, 980, 14, 10, "#a8743f", { shadow: false });
  ctx.restore();
}

function stylusAndArm(ctx, t, alpha) {
  const drop = outCubic(seg(t, 0.4, 1.1));
  const tipY = lerp(GROOVE_Y - 120, GROOVE_Y - 4, drop);
  ctx.save();
  ctx.globalAlpha *= alpha;
  paperCircle(ctx, STYLUS_X, 392, 22, "#e8dfca", { dx: 3, dy: 5 });
  paper(
    ctx,
    (c) => {
      c.moveTo(STYLUS_X - 7, 405);
      c.lineTo(STYLUS_X + 7, 405);
      c.lineTo(STYLUS_X, tipY);
      c.closePath();
    },
    "#e8dfca",
    { dx: 3, dy: 5 },
  );
  ctx.restore();
}

function crank(ctx, t, alpha) {
  const turn = (t * 2 * Math.PI) / 3.2;
  const hub = [1450, 535];
  const arm = 70;
  const knob = [
    hub[0] + arm * Math.cos(turn - Math.PI / 2),
    hub[1] + arm * Math.sin(turn - Math.PI / 2),
  ];
  ctx.save();
  ctx.globalAlpha *= alpha;
  paperRect(ctx, 1356, 521, 100, 28, 8, "#6e4f1b", { shadow: false });
  ctx.strokeStyle = "#e0b552";
  ctx.lineWidth = 16;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(hub[0], hub[1]);
  ctx.lineTo(knob[0], knob[1]);
  ctx.stroke();
  paperCircle(ctx, hub[0], hub[1], 22, BRASS);
  paperCircle(ctx, knob[0], knob[1], 17, "#f0c969");
  const come = outCubic(seg(t, 0.2, 0.9));
  const leave = outCubic(seg(t, PHASE_B - 0.4, PHASE_B + 0.6));
  const scale = 92;
  drawHand(ctx, pose("fist"), {
    x: knob[0] + 0.85 * scale + (1 - come) * 380 + leave * 480,
    y: knob[1] + 4,
    scale,
    rotate: -Math.PI / 2,
    fill: SKIN,
    forearm: 2.6,
    sleeve: "#e8dfca",
  });
  ctx.restore();
}

// ---- phase B: tape
function tapeMachine(ctx, t, alpha) {
  const turn = (tapeTime(t) * V) / 95;
  ctx.save();
  ctx.globalAlpha *= alpha;
  // The deck plate.
  paperRect(ctx, 380, 150, 1160, 560, 28, "#4a3a63", { dx: 6, dy: 10 });
  reel(ctx, ...REELS.left, REELS.r, -turn, {
    fill: "#d6dde0",
    tapeR: REELS.r * 0.9 - 12 * smooth(seg(t, PHASE_B, 19)),
  });
  reel(ctx, ...REELS.right, REELS.r, -turn, {
    fill: "#d6dde0",
    tapeR: REELS.r * 0.62 + 12 * smooth(seg(t, PHASE_B, 19)),
  });
  // The head block under the tape.
  paperRect(ctx, 905, TAPE_Y + 6, 110, 62, 8, "#8c949a", { dx: 3, dy: 5 });
  paperRect(ctx, 930, TAPE_Y + 6, 60, 14, 4, "#2a2d36", { shadow: false });
  // Tape between the reels: a dark strip under the Line.
  paperRect(ctx, TAPE_X0, TAPE_Y - 22, TAPE_X1 - TAPE_X0, 44, 3, "#2a1d17", {
    dx: 2,
    dy: 4,
    alpha: 0.2,
  });
  ctx.restore();
}

function scissors(ctx, t) {
  const p = outCubic(seg(t, SNIP - 0.7, SNIP - 0.05));
  const close = Math.sin(Math.PI * clamp((t - SNIP + 0.12) / 0.34));
  const out = smooth(seg(t, SNIP + 0.5, SNIP + 1.1));
  if (p <= 0 || out >= 1) return;
  const x = 830;
  const y = lerp(TAPE_Y - 280, TAPE_Y - 6, p);
  const open = 0.5 * (1 - (t > SNIP - 0.15 ? close : 0));
  ctx.save();
  ctx.globalAlpha = 1 - out;
  ctx.translate(x, y);
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.rotate(side * open * 0.55);
    paper(
      ctx,
      (c) => {
        c.moveTo(0, 0);
        c.lineTo(side * 16, -120);
        c.lineTo(side * 6, -122);
        c.lineTo(-side * 8, 0);
        c.closePath();
      },
      "#dfe5e8",
      { dx: 3, dy: 5 },
    );
    ctx.restore();
  }
  for (const side of [-1, 1])
    paperCircle(ctx, side * 28, -170, 24, "transparent", {
      shadow: false,
      stroke: PALETTE.vermilion,
      lineWidth: 8,
    });
  ctx.restore();
}

function multitrack(ctx, t, alpha) {
  const p = outCubic(seg(t, REVERSE_END - 0.1, REVERSE_END + 1.1));
  if (p <= 0) return;
  ctx.save();
  ctx.globalAlpha *= alpha * p;
  const x0 = 560;
  const x1 = 1360;
  const top = 556;
  const pitch = 17;
  const colors = [
    PALETTE.mustard,
    PALETTE.sky,
    PALETTE.mint,
    PALETTE.blush,
    PALETTE.sage,
    "#c9b6ff",
    "#ffd6a5",
    "#9ad1c8",
  ];
  paperRect(
    ctx,
    x0 - 20,
    top - 10,
    x1 - x0 + 40,
    8 * pitch + 20,
    10,
    "#2a1d17",
    { dx: 3, dy: 6 },
  );
  colors.forEach((color, i) => {
    const y = top + 12 + i * pitch;
    const wide = x1 - x0;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let k = 0; k <= 160; k++) {
      const x = x0 + (k / 160) * wide;
      const amp = 4.5 * waveAt(t * 0.9 + (x - 960) / V + i * 0.37);
      if (k === 0) ctx.moveTo(x, y + amp);
      else ctx.lineTo(x, y + amp);
    }
    ctx.stroke();
    text(ctx, String(i + 1), x0 - 36, y + 5, {
      font: `600 14px ${FONT.mono}`,
      color,
      align: "right",
    });
  });
  ctx.restore();
}

function stamps(ctx, t) {
  const items = [
    ["CUT", SNIP - 0.1],
    ["LOOP", SNIP + 0.6],
    ["REVERSE", LOOP_END + 0.1],
    ["LAYER", REVERSE_END + 0.1],
  ];
  let x = 1180;
  items.forEach(([label, at], i) => {
    const p = outBack(seg(t, at, at + 0.4), 2.2);
    const width = 46 + label.length * 20;
    if (p > 0) {
      ctx.save();
      ctx.translate(x + width / 2, 800 - (i % 2) * 6);
      ctx.rotate(((i % 2 ? 1 : -1) * 2.2 * Math.PI) / 180);
      ctx.scale(0.7 + 0.3 * p, 0.7 + 0.3 * p);
      ctx.globalAlpha = Math.min(1, p);
      paperRect(ctx, -width / 2, -26, width, 52, 8, "transparent", {
        shadow: false,
        stroke: CREAM,
        lineWidth: 3,
      });
      text(ctx, label, 0, 9, {
        font: `600 26px ${FONT.mono}`,
        color: CREAM,
        align: "center",
        tracking: 3,
      });
      ctx.restore();
    }
    x += width + 24;
  });
}

export default {
  bg: BG,
  ink: CREAM,
  lineColor: PALETTE.vermilion,
  captionAt: 2.0,
  ghostAlpha: 0.055,
  ghostY: 740,

  line(t) {
    if (t < PHASE_B - 0.2) return grooveLine(t);
    const moveToTape = inOutCubic(seg(t, PHASE_B - 0.2, PHASE_B + 0.8));
    const base = morph(grooveLine(t), tapeStraight(t), moveToTape);
    const toLoop =
      inOutCubic(seg(t, SNIP, SNIP + 0.8)) *
      (1 - inOutCubic(seg(t, LOOP_END - 0.2, LOOP_END + 0.7)));
    return toLoop > 0 ? morph(tapeStraight(t), loopLine(t), toLoop) : base;
  },
  lineStyle: () => ({ width: 6 }),

  back(ctx, t) {
    // Surface noise: specks that flicker on the old recording.
    const noiseAmount = 1 - smooth(seg(t, PHASE_B - 0.2, PHASE_B + 0.8));
    for (const d of dust) {
      const on = Math.sin(t * 40 * d.seed + d.seed * 100) > 0.93;
      if (on) fillCircle(ctx, d.x, d.y, d.s, CREAM, 0.5 * noiseAmount);
    }
    const phase1 = 1 - smooth(seg(t, PHASE_B - 0.5, PHASE_B + 0.5));
    if (phase1 > 0.01) {
      ctx.save();
      ctx.translate(0, smooth(seg(t, PHASE_B - 0.5, PHASE_B + 0.5)) * 300);
      const enter = outCubic(seg(t, 0.1, 1.0));
      ctx.translate(-(1 - enter) * 300, 0);
      horn(ctx, t, phase1 * enter);
      phonograph(ctx, t, phase1 * enter);
      ctx.restore();
      // Sound leaving the horn, as rings.
      for (const e of EVENTS) {
        const age = t - e.t;
        if (age < 0 || age > 1.2 || e.w < 0.9) continue;
        ctx.save();
        ctx.strokeStyle = rgba(CREAM, 0.24 * (1 - age / 1.2) * phase1);
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(330, 195, 60 + age * 320, Math.PI * 0.55, Math.PI * 1.45);
        ctx.stroke();
        ctx.restore();
      }
    }
    const tapeIn = smooth(seg(t, PHASE_B, PHASE_B + 1.0));
    if (tapeIn > 0.01) {
      ctx.save();
      ctx.translate(0, (1 - outCubic(seg(t, PHASE_B, PHASE_B + 1.0))) * -320);
      tapeMachine(ctx, t, tapeIn);
      ctx.restore();
    }
    multitrack(ctx, t, 1);
  },

  front(ctx, t) {
    const phase1 = 1 - smooth(seg(t, PHASE_B - 0.5, PHASE_B + 0.5));
    if (phase1 > 0.01) {
      ctx.save();
      ctx.translate(0, smooth(seg(t, PHASE_B - 0.5, PHASE_B + 0.5)) * 300);
      const enter = outCubic(seg(t, 0.1, 1.0));
      ctx.translate(-(1 - enter) * 300, 0);
      stylusAndArm(ctx, t, phase1 * enter);
      crank(ctx, t, phase1 * enter);
      ctx.restore();
    }
    scissors(ctx, t);
    stamps(ctx, t);
    // A date for each medium.
    const a =
      smooth(seg(t, 1.0, 1.6)) *
      (1 - smooth(seg(t, PHASE_B - 0.6, PHASE_B - 0.1)));
    text(ctx, "1877  WAX CYLINDER", 1400, 722, {
      font: `600 18px ${FONT.mono}`,
      color: CREAM,
      align: "right",
      tracking: 3,
      opacity: a * 0.85,
    });
    const b = smooth(seg(t, PHASE_B + 0.6, PHASE_B + 1.2));
    text(ctx, "1948  MAGNETIC TAPE", 1540, 740, {
      font: `600 18px ${FONT.mono}`,
      color: CREAM,
      align: "right",
      tracking: 3,
      opacity: b * 0.85,
    });
  },
};
