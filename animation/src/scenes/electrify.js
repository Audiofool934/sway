// 5. Electrify. A theremin is played without touching it: the right hand's distance from
// the antenna is pitch, and the tune rises from the fingertip as a ribbon. Then a Hammond
// organ: nine drawbars, nine sine waves, pulled out one at a time until the wave is rich.

import {
  FONT,
  PALETTE,
  fillCircle,
  lineSeg,
  paper,
  paperCircle,
  paperRect,
  rgba,
  text,
} from "../core/draw.js";
import {
  clamp,
  inOutCubic,
  lerp,
  outCubic,
  seg,
  smooth,
} from "../core/ease.js";
import { drawHand, place, pose } from "../core/hand.js";
import { fromFunction, morph, wave } from "../core/line.js";
import { cues, motif } from "../score.js";
import { byId } from "../timeline.js";

const C = byId.electrify;
const BG = "#242d73";
const CREAM = "#f4ead2";
const SKIN = "#f0c7a0";
const SPARK = PALETTE.mustard;

// ---- the theremin
const NOTES = motif(28).map((n) => ({
  t: n.t - C.start,
  dur: n.dur,
  midi: n.midi,
}));
const GLIDE = 0.11;
/** The pitch (in MIDI) the player's hand is making at local time t, with the same glides as the sound. */
function pitchAt(t) {
  let i = 0;
  NOTES.forEach((n, k) => {
    if (n.t <= t) i = k;
  });
  const cur = NOTES[i];
  const prev = NOTES[i - 1];
  if (prev && t - cur.t < GLIDE && cur.t - (prev.t + prev.dur) < 0.12)
    return lerp(prev.midi, cur.midi, smooth((t - cur.t) / GLIDE));
  return cur.midi;
}
const HAND_Y = 316;
const ANTENNA_X = 1296;
/** Fingertip position for a pitch: nearer the antenna is higher. */
const tipX = (midi) => lerp(700, 1196, (midi - 64) / 14);
const vibrato = (t) => {
  let i = 0;
  NOTES.forEach((n, k) => {
    if (n.t <= t) i = k;
  });
  return (
    4 * Math.sin(2 * Math.PI * 5.7 * t) * smooth((t - NOTES[i].t - 0.2) / 0.45)
  );
};
const handTip = (t) => tipX(pitchAt(t)) + vibrato(t);
const PHASE_B = 9.6;
const RIBBON_SECONDS = 3.0;
const RIBBON_SPEED = 62;

function ribbon(t) {
  const tNow = Math.min(t, PHASE_B + 0.4);
  return fromFunction((u) => {
    const tau = tNow - (1 - u) * RIBBON_SECONDS;
    const age = tNow - tau;
    return [
      tau < 0 ? tipX(NOTES[0].midi) : handTip(tau),
      HAND_Y - 26 - age * RIBBON_SPEED,
    ];
  });
}

// ---- the organ
const DRAWBARS = cues.electrify.drawbars.map((p) => ({
  ...p,
  t: p.t - C.start,
}));
const FOOTAGE = [
  "16'",
  "5 1/3'",
  "8'",
  "4'",
  "2 2/3'",
  "2'",
  "1 3/5'",
  "1 1/3'",
  "1'",
];
const RATIOS = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8];
const BAR_COLORS = [
  "#6b4326",
  "#6b4326",
  "#f2ecdc",
  "#f2ecdc",
  "#1d1b2e",
  "#f2ecdc",
  "#1d1b2e",
  "#1d1b2e",
  "#f2ecdc",
];
const BAR_X0 = 560;
const BAR_DX = 84;
const SLOT_TOP = 560;
const SLOT_H = 170;
const barX = (i) => BAR_X0 + i * BAR_DX;
/** Slider position (0 = pushed in at the top, 1 = pulled fully out). */
function pulled(i, t) {
  let level = 0;
  for (const p of DRAWBARS) {
    if (p.i !== i) continue;
    level = (p.level / 8) * smooth(seg(t, p.t - 0.5, p.t - 0.04));
  }
  return level;
}
const levelsAt = (t) => Array.from({ length: 9 }, (_, i) => pulled(i, t));

function organWave(t) {
  const levels = levelsAt(t);
  const total = levels.reduce((a, b) => a + b, 0) || 1;
  const phase = t * 1.4;
  return wave(300, 1620, (u) => {
    let y = 0;
    levels.forEach((lv, i) => {
      y +=
        lv *
        Math.sin(
          2 * Math.PI * (RATIOS[i] * 2) * u + phase * (RATIOS[i] * 0.6 + 0.4),
        );
    });
    return 330 - 125 * (y / Math.max(1, total * 0.62));
  });
}

function theremin(ctx, t, alpha) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  // The electric field around the pitch antenna.
  for (let k = 0; k < 5; k++) {
    const pulse = 1 + 0.06 * Math.sin(t * 3 - k);
    ctx.strokeStyle = rgba(SPARK, 0.28 - k * 0.04);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(
      ANTENNA_X,
      340,
      (44 + k * 46) * pulse,
      (170 + k * 50) * pulse,
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  }
  // The cabinet.
  paper(
    ctx,
    (c) => {
      c.moveTo(790, 548);
      c.lineTo(1250, 548);
      c.lineTo(1226, 512);
      c.lineTo(814, 512);
      c.closePath();
    },
    "#b57a45",
    { dx: 4, dy: 7 },
  );
  paperRect(ctx, 790, 548, 460, 150, 10, "#6e4426");
  for (const x of [820, 1220])
    paperRect(ctx, x - 9, 698, 18, 92, 6, "#2a1d17", { shadow: false });
  paperCircle(ctx, 880, 624, 22, "#e8dfca", { dx: 2, dy: 4 });
  paperCircle(ctx, 880, 624, 7, "#2a1d17", { shadow: false });
  paperRect(ctx, 960, 604, 220, 40, 8, "#3a2415", { shadow: false });
  for (let k = 0; k < 8; k++)
    lineSeg(ctx, 976 + k * 26, 614, 976 + k * 26, 634, "#a87a4a", 3);
  // Pitch antenna: a rod on the right.
  paperRect(ctx, ANTENNA_X - 6, 150, 12, 400, 6, "#dfe5e8", { dx: 3, dy: 5 });
  paperCircle(ctx, ANTENNA_X, 150, 15, "#dfe5e8", { dx: 2, dy: 4 });
  paperRect(ctx, ANTENNA_X - 26, 540, 52, 16, 6, "#8c949a", { dx: 2, dy: 3 });
  // Volume antenna: a loop on the left.
  ctx.save();
  ctx.strokeStyle = "#dfe5e8";
  ctx.lineWidth = 9;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(790, 590);
  ctx.lineTo(668, 590);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(590, 590, 80, 26, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

function thereminHands(ctx, t, alpha) {
  const tip = handTip(t);
  const scale = 118;
  ctx.save();
  ctx.globalAlpha *= alpha;
  const come = outCubic(seg(t, 0.2, 1.0));
  // The pitch hand (right): fingers point at the antenna, arm reaching in from the left.
  const open = pose("open");
  const probe = place(open, { x: 0, y: 0, scale, rotate: Math.PI / 2 });
  const mid = probe[12];
  drawHand(ctx, open, {
    x: tip - mid[0] - (1 - come) * 420,
    y: HAND_Y - mid[1],
    scale,
    rotate: Math.PI / 2,
    fill: SKIN,
    forearm: 4.2,
    sleeve: "#e8dfca",
  });
  // The volume hand (left): hovering over the loop; lower is louder.
  let loud = 0;
  NOTES.forEach((n) => {
    const a =
      clamp((t - n.t) / 0.07) *
      (t > n.t + n.dur ? Math.exp(-(t - n.t - n.dur) / 0.06) : 1);
    loud = Math.max(loud, a);
  });
  const vy = lerp(462, 520, loud) + 4 * Math.sin(t * 2.1);
  const turn = Math.PI / 2 - 0.4;
  const lprobe = place(open, {
    x: 0,
    y: 0,
    scale: 104,
    rotate: turn,
    mirror: true,
  });
  const lmid = lprobe[12];
  drawHand(ctx, open, {
    x: 650 - lmid[0] - (1 - come) * 420,
    y: vy - lmid[1],
    scale: 104,
    rotate: turn,
    mirror: true,
    fill: "#e7b995",
    forearm: 4.6,
    sleeve: "#e8dfca",
  });
  ctx.restore();
}

function organ(ctx, t, alpha) {
  const come = outCubic(seg(t, PHASE_B - 0.4, PHASE_B + 0.8));
  if (come <= 0) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(0, (1 - come) * 360);
  paperRect(ctx, 470, 500, 1040, 280, 22, "#4a2f1c", { dx: 6, dy: 10 });
  paperRect(ctx, 470, 500, 1040, 36, 22, "#7a4e2c", { shadow: false });
  // The slots, the sliders, and their footage labels.
  for (let i = 0; i < 9; i++) {
    const x = barX(i);
    paperRect(ctx, x - 8, SLOT_TOP - 4, 16, SLOT_H + 12, 8, "#1b110a", {
      shadow: false,
    });
    const p = pulled(i, t);
    const y = SLOT_TOP + 8 + p * (SLOT_H - 16);
    paper(
      ctx,
      (c) => {
        c.moveTo(x - 22, y - 8);
        c.lineTo(x + 22, y - 8);
        c.lineTo(x + 18, y + 24);
        c.lineTo(x - 18, y + 24);
        c.closePath();
      },
      BAR_COLORS[i],
      { dx: 2, dy: 5 },
    );
    text(ctx, FOOTAGE[i], x, 772, {
      font: `500 14px ${FONT.mono}`,
      color: CREAM,
      align: "center",
      opacity: 0.8,
    });
    text(ctx, String(Math.round(p * 8)), x, SLOT_TOP - 16, {
      font: `600 15px ${FONT.mono}`,
      color: i < 2 ? "#f0c969" : CREAM,
      align: "center",
      opacity: 0.85,
    });
  }
  ctx.restore();
}

/** The hand that pulls the drawbars: pinch the top of a slider, pull it down. */
function organHand(ctx, t) {
  const come = outCubic(seg(t, PHASE_B - 0.4, PHASE_B + 0.8));
  if (come <= 0) return;
  // The pulls in order; between pulls the hand travels to the next slider.
  const seq = DRAWBARS.map((p) => ({
    ...p,
    start: p.t - 0.5,
    end: p.t - 0.04,
  }));
  let target = seq[0];
  let from = null;
  for (let k = 0; k < seq.length; k++)
    if (t >= seq[k].start - 0.4) {
      target = seq[k];
      from = seq[k - 1] ?? null;
    }
  const travel = outCubic(seg(t, target.start - 0.4, target.start));
  const grab = smooth(seg(t, target.start - 0.1, target.start + 0.05));
  const level = pulled(target.i, t);
  const x = lerp(
    from ? barX(from.i) : barX(target.i) + 220,
    barX(target.i),
    travel,
  );
  const knobY = SLOT_TOP + 8 + level * (SLOT_H - 16);
  const fromY = from
    ? SLOT_TOP + 8 + pulled(from.i, t) * (SLOT_H - 16) - 90
    : SLOT_TOP - 150;
  const y = lerp(fromY, knobY - 8, travel) - (1 - grab) * 60 * (1 - travel);
  const leave = smooth(seg(t, seq.at(-1).end + 0.2, seq.at(-1).end + 0.9));
  const scale = 96;
  const rotate = Math.PI;
  const hand = pose("open", "pluck", grab);
  const probe = place(hand, { x: 0, y: 0, scale, rotate });
  const pinch = [
    (probe[4][0] + probe[8][0]) / 2,
    (probe[4][1] + probe[8][1]) / 2,
  ];
  ctx.save();
  ctx.translate(0, (1 - come) * 360);
  ctx.globalAlpha = 1 - leave;
  drawHand(ctx, hand, {
    x: x - pinch[0] + leave * 200,
    y: y - pinch[1] - leave * 260,
    scale,
    rotate,
    fill: SKIN,
    forearm: 3.4,
    sleeve: "#e8dfca",
  });
  ctx.restore();
}

export default {
  bg: BG,
  ink: CREAM,
  lineColor: PALETTE.vermilion,
  captionAt: 2.0,
  ghostAlpha: 0.06,
  ghostY: 760,

  line(t) {
    const p = inOutCubic(seg(t, PHASE_B - 0.8, PHASE_B + 0.5));
    return p <= 0
      ? ribbon(t)
      : p >= 1
        ? organWave(t)
        : morph(ribbon(t), organWave(t), p);
  },
  lineStyle: () => ({ width: 7 }),

  back(ctx, t) {
    const out = 1 - smooth(seg(t, PHASE_B - 0.6, PHASE_B + 0.4));
    if (out > 0.01) {
      ctx.save();
      ctx.translate(-(1 - out) * 160, 0);
      theremin(ctx, t, out);
      ctx.restore();
    }
    organ(ctx, t, 1);
    // A tag for Fourier, once the sliders have begun to build the wave.
    const tag = smooth(seg(t, PHASE_B + 1.0, PHASE_B + 1.8));
    if (tag > 0) {
      ctx.save();
      ctx.globalAlpha = tag;
      paperRect(ctx, 1290, 790, 460, 88, 12, "#efe3c6", { dx: 3, dy: 6 });
      text(ctx, "FOURIER, 1822", 1314, 822, {
        font: `600 15px ${FONT.mono}`,
        color: "#2a1e14",
        tracking: 2,
      });
      text(ctx, "any sound is a sum of sine waves", 1314, 858, {
        font: `italic 500 24px ${FONT.serif}`,
        color: "#2a1e14",
      });
      ctx.restore();
      const n = levelsAt(t).filter((x) => x > 0.01).length;
      text(ctx, `${n} OF 9 SINES`, 300, 524, {
        font: `600 18px ${FONT.mono}`,
        color: SPARK,
        tracking: 3,
        opacity: tag,
      });
    }
  },

  front(ctx, t) {
    const out = 1 - smooth(seg(t, PHASE_B - 0.6, PHASE_B + 0.4));
    if (out > 0.01) {
      ctx.save();
      ctx.translate(-(1 - out) * 160, 0);
      thereminHands(ctx, t, out);
      // The first fingertip glints where the ribbon begins.
      const tip = handTip(t);
      fillCircle(ctx, tip + 12, HAND_Y - 26, 6, SPARK, out);
      ctx.restore();
      const label = smooth(seg(t, 1.4, 2.0)) * out;
      text(ctx, "NO TOUCH", 1380, 300, {
        font: `600 18px ${FONT.mono}`,
        color: SPARK,
        tracking: 4,
        opacity: label * 0.95,
      });
      text(ctx, "pitch is the hand’s distance", 1380, 334, {
        font: `italic 500 24px ${FONT.serif}`,
        color: CREAM,
        opacity: label * 0.85,
      });
      text(ctx, "from the antenna", 1380, 364, {
        font: `italic 500 24px ${FONT.serif}`,
        color: CREAM,
        opacity: label * 0.85,
      });
    }
    organHand(ctx, t);
  },
};
