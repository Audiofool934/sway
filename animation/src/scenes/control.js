// 6. Control. A modular synthesizer: patch cables join oscillator, filter, and amplifier; a
// hand opens the filter and the wave brightens; then the tune itself is drawn as voltage,
// one volt per octave, a staircase of electricity.

import {
  FONT,
  PALETTE,
  fillCircle,
  lineSeg,
  paper,
  paperRect,
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
import { drawHand, place, pose } from "../core/hand.js";
import { morph, wave } from "../core/line.js";
import { cable, jack, knob } from "../core/props.js";
import { motif } from "../score.js";
import { byId } from "../timeline.js";

const C = byId.control;
const BG = "#e0a43a";
const INK = "#2a1d10";
const SKIN = "#f0c7a0";
const PANEL = "#17181d";

const NOTES = motif(36).map((n) => ({
  t: n.t - C.start,
  dur: n.dur,
  midi: n.midi,
}));
const SCOPE = { x: 300, y: 176, w: 1320, h: 168 };
const SCOPE_MID = SCOPE.y + SCOPE.h / 2;

/** How far the filter is open (0 to 1): the sound's knob turns the same way. */
const cutoff = (t) => clamp(t / 9.6);

/** A sawtooth through a low-pass: harmonics roll off above the cutoff. */
function sawWave(t) {
  const open = cutoff(t);
  const kc = 1.4 + 17 * open ** 1.2;
  const cycles = 5;
  const phase = t * 2.0;
  return wave(SCOPE.x, SCOPE.x + SCOPE.w, (u) => {
    let y = 0;
    for (let k = 1; k <= 30; k++)
      y +=
        ((1 / Math.sqrt(1 + (k / kc) ** 4)) *
          Math.sin(2 * Math.PI * k * cycles * u + phase * k * 0.25)) /
        k;
    return SCOPE_MID - 0.62 * SCOPE.h * y * 0.72;
  });
}

/** The tune as control voltage: one volt per octave, a step for each note. */
const volts = (midi) =>
  SCOPE.y + SCOPE.h - 18 - ((midi - 64) / 12) * (SCOPE.h - 44);
function staircase(t) {
  const x0 = SCOPE.x + 24;
  const span = SCOPE.w - 48;
  return wave(
    x0,
    x0 + span,
    (u) => {
      const tt = u * 9.0 + 0.2;
      let y = volts(NOTES[0].midi);
      let prev = NOTES[0].midi;
      for (const n of NOTES) {
        if (n.t <= tt) {
          const k = clamp((tt - n.t) / 0.07);
          y = lerp(volts(prev), volts(n.midi), k);
          if (k >= 1) prev = n.midi;
        }
      }
      return y;
    },
    360,
  );
}

const STAIRS = [5.6, 6.8];

function patch(ctx, t) {
  const drops = [
    { from: [610, 596], to: [740, 596], color: "#2fb8a9", at: 1.9 },
    { from: [1010, 596], to: [1140, 600], color: "#f4ead2", at: 2.4 },
    {
      from: [1600, 596],
      to: [660, 300],
      color: "#b184d1",
      at: 2.9,
      hidden: true,
    },
  ];
  for (const d of drops) {
    if (d.hidden) continue;
    const age = t - d.at;
    if (age < -0.4) continue;
    const drop = outCubic(seg(age, -0.4, 0.2));
    const sway =
      38 *
      Math.exp(-Math.max(0, age) / 0.55) *
      Math.sin(2 * Math.PI * 1.7 * Math.max(0, age));
    const [x1, y1] = d.from;
    const [x2, y2] = d.to;
    cable(
      ctx,
      x1,
      lerp(y1 - 380, y1, drop),
      x2,
      lerp(y2 - 380, y2, drop),
      d.color,
      { sag: 70, width: 10, sway },
    );
    if (drop > 0.95) {
      jack(ctx, x1, y1, 11);
      jack(ctx, x2, y2, 11);
      fillCircle(ctx, x1, y1, 7, d.color);
      fillCircle(ctx, x2, y2, 7, d.color);
    }
  }
}

function envelopeShape(ctx, x, y, w, h, t) {
  // ADSR: attack up, decay to sustain, hold, release.
  const pts = [
    [0, 1],
    [0.18, 0],
    [0.4, 0.38],
    [0.72, 0.38],
    [1, 1],
  ];
  ctx.save();
  ctx.strokeStyle = "#f2b544";
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.beginPath();
  pts.forEach(([u, v], i) =>
    i ? ctx.lineTo(x + u * w, y + v * h) : ctx.moveTo(x + u * w, y + v * h),
  );
  ctx.stroke();
  // A bead rides the envelope each time a key goes down.
  for (const n of NOTES) {
    const age = t - n.t;
    if (age < 0 || age > 0.9) continue;
    const u = clamp(age / 0.9);
    const along = u * pts.at(-1)[0];
    let k = 0;
    while (k < pts.length - 2 && pts[k + 1][0] < along) k++;
    const f = (along - pts[k][0]) / (pts[k + 1][0] - pts[k][0]);
    fillCircle(
      ctx,
      x + lerp(pts[k][0], pts[k + 1][0], f) * w,
      y + lerp(pts[k][1], pts[k + 1][1], f) * h,
      8,
      "#ff5b3a",
      1 - u * 0.4,
    );
  }
  ctx.restore();
}

function panel(ctx, t) {
  const come = outBack(seg(t, 0.9, 1.9), 1.3);
  ctx.save();
  ctx.translate(0, (1 - clamp(come, 0, 1.2)) * 420);
  ctx.globalAlpha = smooth(seg(t, 0.8, 1.4));
  // Walnut frame and black panel.
  paperRect(ctx, 226, 128, 1468, 532, 24, "#6b4326", { dx: 6, dy: 12 });
  paperRect(ctx, 252, 152, 1416, 484, 10, PANEL, { shadow: false });
  // The scope.
  paperRect(
    ctx,
    SCOPE.x - 16,
    SCOPE.y - 8,
    SCOPE.w + 32,
    SCOPE.h + 16,
    12,
    "#0d1b22",
    { shadow: false },
  );
  for (let k = 1; k < 8; k++)
    lineSeg(
      ctx,
      SCOPE.x - 16 + (k * (SCOPE.w + 32)) / 8,
      SCOPE.y - 8,
      SCOPE.x - 16 + (k * (SCOPE.w + 32)) / 8,
      SCOPE.y + SCOPE.h + 8,
      "#2a4350",
      1.5,
      { opacity: 0.6 },
    );
  for (let k = 1; k < 4; k++)
    lineSeg(
      ctx,
      SCOPE.x - 16,
      SCOPE.y - 8 + (k * (SCOPE.h + 16)) / 4,
      SCOPE.x + SCOPE.w + 16,
      SCOPE.y - 8 + (k * (SCOPE.h + 16)) / 4,
      "#2a4350",
      1.5,
      { opacity: 0.6 },
    );

  // Three modules.
  const modules = [
    { x: 280, w: 380, title: "OSCILLATOR" },
    { x: 690, w: 390, title: "FILTER" },
    { x: 1110, w: 530, title: "AMPLIFIER + ENVELOPE" },
  ];
  modules.forEach((m) => {
    paperRect(ctx, m.x, 372, m.w, 248, 10, "#23252c", { shadow: false });
    text(ctx, m.title, m.x + 18, 400, {
      font: `600 14px ${FONT.mono}`,
      color: "#cfd3dc",
      tracking: 3,
      opacity: 0.85,
    });
  });
  // Oscillator: waveform choices (the saw is lit) and a frequency knob.
  const icons = [
    [
      [0, 1],
      [0.5, -1],
      [0.5, 1],
      [1, -1],
    ], // saw-ish
    [
      [0, 1],
      [0, -1],
      [0.5, -1],
      [0.5, 1],
      [1, 1],
      [1, -1],
    ], // square
    [
      [0, 0.7],
      [0.25, -0.7],
      [0.75, 0.7],
      [1, -0.7],
    ], // triangle
  ];
  icons.forEach((pts, i) => {
    const x = 316 + i * 80;
    paperRect(ctx, x - 8, 430, 70, 56, 8, i === 0 ? "#3a3d47" : "#2a2c34", {
      shadow: false,
    });
    ctx.strokeStyle = i === 0 ? "#f2b544" : "#6b6f7b";
    ctx.lineWidth = 3;
    ctx.beginPath();
    pts.forEach(([u, v], k) =>
      k
        ? ctx.lineTo(x + 4 + u * 50, 458 + v * 16)
        : ctx.moveTo(x + 4 + u * 50, 458 + v * 16),
    );
    ctx.stroke();
  });
  knob(ctx, 560, 520, 38, -0.4 + Math.sin(t * 0.3) * 0.02, { ring: "#cfd3dc" });
  text(ctx, "FREQ", 560, 590, {
    font: `500 13px ${FONT.mono}`,
    color: "#cfd3dc",
    align: "center",
    tracking: 2,
    opacity: 0.8,
  });
  // Filter: cutoff and resonance knobs.
  const turn = lerp(-2.0, 2.0, cutoff(t));
  knob(ctx, 810, 508, 52, turn, { ring: "#f2b544", cap: "#ff8a6a" });
  text(ctx, "CUTOFF", 810, 590, {
    font: `600 13px ${FONT.mono}`,
    color: "#f2b544",
    align: "center",
    tracking: 2,
  });
  knob(ctx, 970, 520, 34, 0.5, { ring: "#cfd3dc" });
  text(ctx, "RESONANCE", 970, 590, {
    font: `500 13px ${FONT.mono}`,
    color: "#cfd3dc",
    align: "center",
    tracking: 1,
    opacity: 0.8,
  });
  // Envelope sliders and the shape they make.
  ["A", "D", "S", "R"].forEach((label, i) => {
    const x = 1160 + i * 66;
    paperRect(ctx, x - 6, 432, 12, 130, 6, "#0d0e12", { shadow: false });
    const level = [0.15, 0.4, 0.62, 0.3][i];
    paperRect(ctx, x - 16, 432 + (1 - level) * 108, 32, 22, 5, "#e8e2d2", {
      dx: 2,
      dy: 4,
    });
    text(ctx, label, x, 590, {
      font: `600 14px ${FONT.mono}`,
      color: "#cfd3dc",
      align: "center",
    });
  });
  envelopeShape(ctx, 1450, 446, 160, 110, t);

  // Jacks and the cables between them.
  for (const [x, y] of [
    [610, 596],
    [740, 596],
    [1010, 596],
    [1140, 600],
  ])
    jack(ctx, x, y, 11);
  patch(ctx, t);
  ctx.restore();
}

function keyboard(ctx, t) {
  const come = outCubic(seg(t, 5.0, 6.0));
  if (come <= 0) return;
  const whites = [67, 69, 71, 72, 74, 76];
  const blacks = [
    [68, 0],
    [70, 1],
    [73, 3],
    [75, 4],
  ];
  const x0 = 700;
  const W = 86;
  const top = 700;
  ctx.save();
  ctx.translate(0, (1 - come) * 130);
  const down = (midi) =>
    NOTES.some((n) => t >= n.t && t < n.t + n.dur * 0.95 && n.midi === midi);
  whites.forEach((m, i) =>
    paper(
      ctx,
      (c) => {
        c.rect(x0 + i * W + 2, top + (down(m) ? 6 : 0), W - 4, 80);
      },
      down(m) ? "#ffb59d" : "#fbf7ea",
      { dx: 2, dy: 4, alpha: 0.2 },
    ),
  );
  blacks.forEach(([m, i]) =>
    paper(
      ctx,
      (c) => {
        c.rect(x0 + (i + 1) * W - 14, top, 28, 48);
      },
      "#1d1b2e",
      { dx: 2, dy: 4, alpha: 0.3 },
    ),
  );
  text(ctx, "1 VOLT PER OCTAVE", x0 + 3 * W, top + 112, {
    font: `600 16px ${FONT.mono}`,
    color: INK,
    align: "center",
    tracking: 4,
    opacity: 0.85,
  });
  ctx.restore();
}

export default {
  bg: BG,
  ink: INK,
  lineColor: PALETTE.vermilion,
  captionAt: 1.8,
  ghostAlpha: 0.08,
  ghostY: 780,

  line(t) {
    const p = inOutCubic(seg(t, ...STAIRS));
    return p <= 0
      ? sawWave(t)
      : p >= 1
        ? staircase(t)
        : morph(sawWave(t), staircase(t), p);
  },
  lineStyle: () => ({ width: 6 }),

  back(ctx, t) {
    panel(ctx, t);
    keyboard(ctx, t);
    // Voltage ticks beside the staircase.
    const ticks = smooth(seg(t, 6.4, 7.2));
    if (ticks > 0) {
      for (const [midi, label] of [
        [64, "0 V"],
        [76, "+1 V"],
      ]) {
        const y = volts(midi);
        lineSeg(
          ctx,
          SCOPE.x - 10,
          y,
          SCOPE.x + SCOPE.w + 10,
          y,
          "#6fd2c4",
          1.5,
          { opacity: ticks * 0.5 },
        );
        text(ctx, label, SCOPE.x + SCOPE.w - 4, y - 8, {
          font: `600 15px ${FONT.mono}`,
          color: "#6fd2c4",
          align: "right",
          opacity: ticks,
        });
      }
    }
    // The playhead over the staircase.
    const head = smooth(seg(t, 6.4, 7.0));
    if (head > 0) {
      const x = SCOPE.x + 24 + clamp((t - 0.2) / 9.0) * (SCOPE.w - 48);
      lineSeg(ctx, x, SCOPE.y - 4, x, SCOPE.y + SCOPE.h + 4, "#f4ead2", 2, {
        opacity: head * 0.6,
      });
    }
  },

  front(ctx, t) {
    // The hand that opens the filter: pinch the knob's rim and turn it.
    const come = outCubic(seg(t, 2.0, 2.8));
    const leave = outCubic(seg(t, 8.6, 9.5));
    if (come > 0 && leave < 1) {
      const turn = lerp(-2.0, 2.0, cutoff(t));
      const a = turn - Math.PI / 2;
      const knobC = [810, 508];
      const r = 56;
      const rim = [knobC[0] + Math.cos(a) * r, knobC[1] + Math.sin(a) * r];
      const scale = 92;
      const rotate = Math.PI + 0.35;
      const grip = smooth(seg(t, 2.5, 2.9));
      const hand = pose("open", "pluck", grip);
      const probe = place(hand, { x: 0, y: 0, scale, rotate });
      const pinch = [
        (probe[4][0] + probe[8][0]) / 2,
        (probe[4][1] + probe[8][1]) / 2,
      ];
      ctx.save();
      ctx.translate(
        0,
        (1 - clamp(outBack(seg(t, 0.9, 1.9), 1.3), 0, 1.2)) * 420,
      );
      ctx.globalAlpha = come * (1 - leave);
      drawHand(ctx, hand, {
        x: rim[0] - pinch[0] + (1 - come) * 220 + leave * 260,
        y: rim[1] - pinch[1] - (1 - come) * 180 - leave * 300,
        scale,
        rotate,
        fill: SKIN,
        forearm: 3.6,
        sleeve: "#e8dfca",
      });
      ctx.restore();
    }
    // The staircase's caption tag.
    const tag = smooth(seg(t, 6.8, 7.5));
    if (tag > 0) {
      ctx.save();
      ctx.globalAlpha = tag;
      paperRect(ctx, 1230, 612, 400, 62, 12, "#fbf3dc", { dx: 3, dy: 6 });
      text(ctx, "A MELODY, AS VOLTAGE", 1252, 650, {
        font: `600 17px ${FONT.mono}`,
        color: INK,
        tracking: 3,
      });
      ctx.restore();
    }
  },
};
