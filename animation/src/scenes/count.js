// 7. Count. A smooth wave is sampled: dots on a grid, then finer and finer as the sampling
// rate and bit depth climb (the sound resolves in step with the picture). A Nyquist inset
// shows aliasing, a wave that was never there; then the numbers stream, and a spectrum
// shows what an equalizer is: sine waves you can reach in and change.

import {
  FONT,
  PALETTE,
  fillCircle,
  lineSeg,
  paperRect,
  rgba,
  text,
} from "../core/draw.js";
import { clamp, lerp, outBack, outCubic, seg, smooth } from "../core/ease.js";
import { wave } from "../core/line.js";
import { cues } from "../score.js";
import { byId } from "../timeline.js";

const C = byId.count;
const BG = "#12141f";
const INK = "#e8ecf5";
const TEAL = "#4fd1c5";
const AMBER = "#ffb547";
const STEPS = cues.count.steps.map((s) => ({ ...s, t: s.t - C.start }));
const ALIAS = { t: cues.count.alias.t - C.start, dur: cues.count.alias.dur };
const SPECTRUM_AT = cues.count.spectrum - C.start;

const PLOT = { x: 240, w: 1440, cy: 474, amp: 168 };
const SAMPLES = {
  4000: 24,
  6000: 36,
  12000: 72,
  22050: 132,
  32000: 190,
  44100: 260,
};
const fmtRate = (r) => r.toLocaleString("en-US");
const fmtLevels = (bits) => (2 ** bits).toLocaleString("en-US");

function stepAt(t) {
  let current = null;
  for (const s of STEPS) if (s.t <= t) current = s;
  return current;
}

// The wave being sampled: three sines, whose heights the equalizer can later change.
const COMPONENTS = [
  { cycles: 3, amp: 0.62, phase: 0 },
  { cycles: 7, amp: 0.28, phase: 0.5 },
  { cycles: 11, amp: 0.12, phase: 1.1 },
];
/** The equalizer gain on the 7x component, as it is dragged up, then down. */
const eqGain = (t) =>
  1 + 1.7 * smooth(seg(t, 13.6, 15.2)) - 2.4 * smooth(seg(t, 16.4, 18.0));
const gains = (t) => [1, Math.max(0.05, eqGain(t)), 1];

function trueWave(u, t) {
  const g = gains(t);
  let y = 0;
  COMPONENTS.forEach((c, i) => {
    y +=
      c.amp *
      g[i] *
      Math.sin(2 * Math.PI * c.cycles * u + c.phase + t * 0.5 * (i + 1) * 0.35);
  });
  return y;
}
const quantize = (v, bits) => {
  const half = 2 ** (bits - 1);
  return clamp(Math.round(v * half) / half, -1, 1);
};
const yOf = (v) => PLOT.cy - v * PLOT.amp;

function mainLine(t) {
  const squeeze = smooth(seg(t, SPECTRUM_AT - 0.4, SPECTRUM_AT + 0.8));
  const cy = lerp(PLOT.cy, 310, squeeze);
  const amp = lerp(PLOT.amp, 78, squeeze);
  return wave(
    PLOT.x,
    PLOT.x + PLOT.w,
    (u) => cy - trueWave(u, t) * amp * (1 / 1.02),
  );
}

// ---- the Nyquist inset
const INSET = { x: 1140, y: 118, w: 540, h: 176 };
const NYQUIST_SAMPLES = 24;
const aliasCycles = (t) => 3 * (22 / 3) ** seg(t, ALIAS.t, ALIAS.t + ALIAS.dur);
/** The slow wave the samples seem to describe (frequency folded back into [0, fs/2]). */
const aliasOf = (f) => {
  const r = f % NYQUIST_SAMPLES;
  return r > NYQUIST_SAMPLES / 2 ? NYQUIST_SAMPLES - r : r;
};

function nyquistInset(ctx, t) {
  const show =
    smooth(seg(t, ALIAS.t - 0.3, ALIAS.t + 0.2)) *
    (1 - smooth(seg(t, ALIAS.t + ALIAS.dur + 0.1, ALIAS.t + ALIAS.dur + 0.7)));
  if (show <= 0) return;
  const f = aliasCycles(t);
  const heard = aliasOf(f);
  const folded = f > NYQUIST_SAMPLES / 2;
  ctx.save();
  ctx.globalAlpha = show;
  paperRect(ctx, INSET.x, INSET.y, INSET.w, INSET.h, 14, "#0b0d15", {
    dx: 4,
    dy: 8,
  });
  const cy = INSET.y + INSET.h / 2 + 8;
  const amp = 52;
  const x0 = INSET.x + 20;
  const w = INSET.w - 40;
  lineSeg(ctx, x0, cy, x0 + w, cy, "#2a3040", 1.5);
  // The true wave, and the samples taken of it at a fixed rate.
  ctx.strokeStyle = rgba(PALETTE.vermilion, folded ? 0.55 : 0.9);
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let k = 0; k <= 300; k++) {
    const u = k / 300;
    const y = cy - amp * Math.sin(2 * Math.PI * f * u);
    k ? ctx.lineTo(x0 + u * w, y) : ctx.moveTo(x0 + u * w, y);
  }
  ctx.stroke();
  const pts = Array.from({ length: NYQUIST_SAMPLES + 1 }, (_, k) => {
    const u = k / NYQUIST_SAMPLES;
    return [x0 + u * w, cy - amp * Math.sin(2 * Math.PI * f * u)];
  });
  for (const [x, y] of pts) {
    lineSeg(ctx, x, cy, x, y, rgba(TEAL, 0.5), 1.5);
    fillCircle(ctx, x, y, 4.5, TEAL);
  }
  // What the dots add up to: the apparent wave. Past half the rate it is a different, slower one.
  ctx.strokeStyle = folded ? AMBER : rgba(TEAL, 0);
  ctx.lineWidth = 4;
  ctx.setLineDash(folded ? [10, 7] : []);
  ctx.beginPath();
  for (let k = 0; k <= 200; k++) {
    const u = k / 200;
    const y =
      cy -
      amp *
        Math.sin(2 * Math.PI * heard * u + (folded ? Math.PI : 0)) *
        (folded ? -1 : 1);
    k ? ctx.lineTo(x0 + u * w, y) : ctx.moveTo(x0 + u * w, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  text(ctx, "NYQUIST", INSET.x + 20, INSET.y + 30, {
    font: `600 14px ${FONT.mono}`,
    color: INK,
    tracking: 3,
    opacity: 0.85,
  });
  text(
    ctx,
    folded ? "ABOVE HALF THE RATE: AN ALIAS" : "BELOW HALF THE RATE: FAITHFUL",
    INSET.x + INSET.w - 20,
    INSET.y + 30,
    {
      font: `600 14px ${FONT.mono}`,
      color: folded ? AMBER : TEAL,
      align: "right",
      tracking: 2,
    },
  );
  text(ctx, "fs > 2 × f", INSET.x + INSET.w - 20, INSET.y + INSET.h - 14, {
    font: `italic 500 22px ${FONT.serif}`,
    color: INK,
    align: "right",
    opacity: 0.9,
  });
  ctx.restore();
}

// ---- spectrum
const BARS = 44;
const BAR_W = 28;
const SPEC_BASE = 650;
const SPEC_H = 170;
const SPEC_X = PLOT.x + (PLOT.w - BARS * BAR_W) / 2;
/** Bar heights: the three components as peaks over a low noise floor. */
function spectrum(t) {
  const g = gains(t);
  return Array.from({ length: BARS }, (_, i) => {
    let h = 0.04 + 0.025 * Math.abs(Math.sin(i * 12.989 + t * 2.3));
    COMPONENTS.forEach((c, k) => {
      const centre = c.cycles * 3.1 + 2;
      h += c.amp * g[k] * 1.5 * Math.exp(-((i - centre) ** 2) / 0.9);
    });
    return clamp(h, 0, 1);
  });
}

function drawSpectrum(ctx, t) {
  const show = outCubic(seg(t, SPECTRUM_AT, SPECTRUM_AT + 1.0));
  if (show <= 0) return;
  const bars = spectrum(t);
  ctx.save();
  ctx.globalAlpha = show;
  lineSeg(
    ctx,
    SPEC_X - 10,
    SPEC_BASE + 6,
    SPEC_X + BARS * BAR_W + 10,
    SPEC_BASE + 6,
    "#3a4054",
    2,
  );
  bars.forEach((h, i) => {
    const hot = i >= 19 && i <= 25;
    const bh = h * SPEC_H * show;
    ctx.fillStyle = hot ? AMBER : TEAL;
    ctx.globalAlpha = show * (hot ? 1 : 0.85);
    ctx.beginPath();
    ctx.roundRect(SPEC_X + i * BAR_W + 3, SPEC_BASE - bh, BAR_W - 6, bh, 4);
    ctx.fill();
  });
  ctx.globalAlpha = show;
  // The equalizer: a handle on the 7x peak that is dragged up, then down.
  const hx = SPEC_X + (7 * 3.1 + 2) * BAR_W + BAR_W / 2;
  const hy = SPEC_BASE - spectrum(t)[Math.round(7 * 3.1 + 2)] * SPEC_H - 26;
  const drag = smooth(seg(t, 13.2, 13.6)) * (1 - smooth(seg(t, 18.0, 18.6)));
  if (drag > 0) {
    ctx.strokeStyle = rgba(AMBER, 0.9 * drag);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(hx, hy + 16, 60, 18, 0, Math.PI, 0);
    ctx.stroke();
    fillCircle(ctx, hx, hy, 12, AMBER, drag);
    fillCircle(ctx, hx, hy, 5, "#12141f", drag);
  }
  text(ctx, "SPECTRUM", SPEC_X, SPEC_BASE + 40, {
    font: `600 15px ${FONT.mono}`,
    color: INK,
    tracking: 4,
    opacity: 0.8,
  });
  text(
    ctx,
    "FOURIER 1822  ·  FFT 1965",
    SPEC_X + BARS * BAR_W,
    SPEC_BASE + 40,
    {
      font: `500 15px ${FONT.mono}`,
      color: INK,
      align: "right",
      tracking: 3,
      opacity: 0.6,
    },
  );
  ctx.restore();
}

// ---- samples and numbers
/** The samples taken so far for the current step: [x, y, value] for each dot. */
function samplePoints(t) {
  const step = stepAt(t);
  if (!step) return null;
  const squeeze = 1 - smooth(seg(t, SPECTRUM_AT - 0.4, SPECTRUM_AT + 0.6));
  if (squeeze <= 0.01) return null;
  const n = SAMPLES[step.rate];
  const sweep = clamp((t - step.t) / 0.7);
  const pts = [];
  for (let k = 0; k < n; k++) {
    const u = (k + 0.5) / n;
    if (u > sweep * 1.02) break;
    const v = quantize(trueWave(u, t), step.bits);
    pts.push([PLOT.x + u * PLOT.w, yOf(v), v]);
  }
  return { step, squeeze, n, pts };
}

function drawSamples(ctx, t) {
  const samples = samplePoints(t);
  if (!samples) return;
  const { step, squeeze, n, pts } = samples;
  const levels = step.bits <= 6;
  ctx.save();
  ctx.globalAlpha = squeeze;
  // Quantization levels, while there are few enough to see.
  if (levels) {
    const half = 2 ** (step.bits - 1);
    for (let k = -half; k <= half; k++)
      lineSeg(
        ctx,
        PLOT.x - 8,
        yOf(k / half),
        PLOT.x + PLOT.w + 8,
        yOf(k / half),
        "#2a3144",
        1.2,
        { opacity: 0.9 },
      );
  }
  // Reconstruction: join the dots.
  ctx.strokeStyle = rgba(TEAL, 0.55);
  ctx.lineWidth = 2;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
  const stemAlpha = 1 - smooth(seg(t, 10.2, 11.6));
  const r = n > 120 ? 3.2 : n > 60 ? 4.2 : 6;
  for (const [x, y] of pts) {
    lineSeg(ctx, x, PLOT.cy, x, y, rgba(TEAL, 0.5), n > 120 ? 1.4 : 2.2, {
      opacity: stemAlpha,
    });
    fillCircle(ctx, x, y, r, TEAL);
  }
  ctx.restore();
}

/** Numbers beside a few dots (drawn over the Line, with a halo), before they become a stream of digits. */
function drawNumbers(ctx, t) {
  const num = smooth(seg(t, 9.6, 10.3));
  const samples = num > 0 ? samplePoints(t) : null;
  if (!samples) return;
  const { squeeze, n, pts } = samples;
  const every = Math.max(1, Math.round(n / 22));
  pts.forEach(([x, y, v], i) => {
    if (i % every) return;
    text(ctx, (v >= 0 ? "+" : "") + v.toFixed(2), x, y + (v >= 0 ? -16 : 28), {
      font: `500 14px ${FONT.mono}`,
      color: AMBER,
      align: "center",
      opacity: num * squeeze,
      stroke: BG,
      strokeWidth: 5,
    });
  });
}

function drawStream(ctx, t) {
  const a =
    smooth(seg(t, 10.6, 11.4)) *
    (1 - smooth(seg(t, SPECTRUM_AT + 0.5, SPECTRUM_AT + 1.4)));
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.beginPath();
  ctx.rect(PLOT.x - 8, 690, PLOT.w + 16, 60);
  ctx.clip();
  const shift = ((t - 10.6) * 190) % 100;
  for (let i = -2; i < 18; i++) {
    const idx = i + Math.floor((t - 10.6) * 1.9);
    const v = trueWave(((idx % 260) + 260) / 260 / 1.0, t);
    text(
      ctx,
      (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(3),
      PLOT.x + i * 100 - shift,
      728,
      { font: `500 22px ${FONT.mono}`, color: AMBER, opacity: 0.85 },
    );
  }
  ctx.restore();
}

function readout(ctx, t) {
  const step = stepAt(t);
  if (!step) return;
  const fade = 1 - smooth(seg(t, SPECTRUM_AT - 0.2, SPECTRUM_AT + 0.6));
  if (fade <= 0.01) return;
  const k = STEPS.indexOf(step);
  const pop = outBack(seg(t, step.t, step.t + 0.35), 2);
  ctx.save();
  ctx.globalAlpha = fade;
  text(ctx, "SAMPLE RATE", PLOT.x, 152, {
    font: `500 15px ${FONT.mono}`,
    color: INK,
    tracking: 3,
    opacity: 0.6,
  });
  text(ctx, `${fmtRate(step.rate)} / s`, PLOT.x, 196 - (1 - pop) * 8, {
    font: `600 40px ${FONT.serif}`,
    color: INK,
  });
  text(ctx, "BIT DEPTH", PLOT.x + 420, 152, {
    font: `500 15px ${FONT.mono}`,
    color: INK,
    tracking: 3,
    opacity: 0.6,
  });
  text(ctx, `${step.bits}-bit`, PLOT.x + 420, 196 - (1 - pop) * 8, {
    font: `600 40px ${FONT.serif}`,
    color: INK,
  });
  text(ctx, `${fmtLevels(step.bits)} levels`, PLOT.x + 420 + 150, 196, {
    font: `500 18px ${FONT.mono}`,
    color: AMBER,
  });
  if (k === STEPS.length - 1)
    text(ctx, "COMPACT DISC, 1982", PLOT.x + 840, 196, {
      font: `600 18px ${FONT.mono}`,
      color: TEAL,
      tracking: 3,
      opacity: smooth(seg(t, step.t + 0.3, step.t + 0.8)),
    });
  ctx.restore();
}

export default {
  bg: BG,
  ink: INK,
  lineColor: PALETTE.vermilion,
  captionAt: 1.9,
  ghostAlpha: 0.05,
  ghostY: 560,

  line: mainLine,
  lineStyle: () => ({ width: 5 }),

  back(ctx, t) {
    // The baseline of the plot.
    lineSeg(
      ctx,
      PLOT.x - 8,
      PLOT.cy,
      PLOT.x + PLOT.w + 8,
      PLOT.cy,
      "#2a3144",
      1.5,
    );
    drawSamples(ctx, t);
    drawStream(ctx, t);
    drawSpectrum(ctx, t);
    nyquistInset(ctx, t);
    readout(ctx, t);

    // What a list of numbers lets you do.
    let chipX = 1250;
    [
      ["STORE", 10.8],
      ["ANALYZE", 12.6],
      ["CHANGE", 14.2],
    ].forEach(([label, at], i) => {
      const w = 40 + label.length * 15;
      const x = chipX;
      chipX += w + 18;
      const p = outBack(seg(t, at, at + 0.4), 2);
      if (p <= 0) return;
      ctx.save();
      ctx.translate(x, 126);
      ctx.scale(0.8 + 0.2 * p, 0.8 + 0.2 * p);
      ctx.globalAlpha = Math.min(1, p);
      paperRect(ctx, 0, 0, w, 34, 17, i === 2 ? AMBER : "transparent", {
        shadow: false,
        stroke: i === 2 ? AMBER : INK,
        lineWidth: 2,
      });
      text(ctx, label, w / 2, 24, {
        font: `600 14px ${FONT.mono}`,
        color: i === 2 ? "#12141f" : INK,
        align: "center",
        tracking: 2,
      });
      ctx.restore();
    });
  },

  front(ctx, t) {
    drawNumbers(ctx, t);
  },
};
