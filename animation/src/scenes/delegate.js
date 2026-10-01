// 10. Delegate. The DAW has stopped; the page is blank, and a hand hesitates over it, then
// crumbles into paper. Loops of unequal lengths begin to play themselves (the Line threads
// through the notes they make), a cloud of notes arrives, and a checklist shows what the
// machine can now supply: harmony, timing, arrangement, sound. One box stays empty.

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
import { clamp, lerp, outBack, outCubic, seg, smooth } from "../core/ease.js";
import { drawHand, pose } from "../core/hand.js";
import { resample, straight } from "../core/line.js";
import { check } from "../core/props.js";
import { rng } from "../core/rand.js";
import { cues } from "../score.js";
import { BEAT, atBar, byId } from "../timeline.js";

const C = byId.delegate;
const BG = "#f6eedc";
const INK = "#1d1b2e";
const SKIN = "#f0c7a0";
const COLORS = {
  box: "#f2b544",
  bell: "#4f9bd6",
  low: "#8a5aa6",
  spark: "#ff5b3a",
};

// ---- the loops
const START = cues.delegate.start - C.start;
const LOOPS = cues.delegate.loops.map((l) => ({
  ...l,
  enters: (l.enters ?? cues.delegate.start) - C.start,
}));
const EVENTS = [];
for (const loop of LOOPS) {
  const length = loop.beats * BEAT;
  for (let cycle = 0; loop.enters + cycle * length < C.duration; cycle++)
    for (const [beat, midi] of loop.notes) {
      const t = loop.enters + cycle * length + beat * BEAT;
      if (t < C.duration) EVENTS.push({ t, midi, loop: loop.id, cycle });
    }
}
EVENTS.sort((a, b) => a.t - b.t);

// The cloud of notes the model "writes": the same random sequence the soundtrack uses.
const CLOUD = (() => {
  const r = rng(404);
  const ladder = [57, 60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84];
  const start = atBar(68) - C.start;
  return Array.from({ length: 46 }, () => {
    const t = start + r() * 2.4 * 3.6;
    const midi = ladder[Math.floor(r() * ladder.length)];
    const x = r();
    r();
    r();
    return { t, midi, x };
  });
})();

// ---- the scrolling roll
const ROLL = { x: 150, y: 150, w: 860, h: 480 };
const NOW_X = ROLL.x + ROLL.w - 60;
const SPEED = 82;
const pitchY = (midi) =>
  ROLL.y + ROLL.h - 24 - ((midi - 50) / 36) * (ROLL.h - 48);
const noteX = (t, now) => NOW_X - (now - t) * SPEED;

const CARD_AT = 14.0;

function lineAt(t) {
  // The Line threads through the notes the loops have just played.
  const recent = EVENTS.filter((e) => e.t <= t && e.t > t - 6);
  if (recent.length < 2)
    return straight(ROLL.x, ROLL.y + ROLL.h - 24, NOW_X, ROLL.y + ROLL.h - 24);
  const flat = [];
  for (const e of recent) flat.push(noteX(e.t, t), pitchY(e.midi));
  flat.push(NOW_X + 30, pitchY(recent.at(-1).midi));
  const crumpled = resample(flat);
  const away = smooth(seg(t, CARD_AT - 0.6, CARD_AT + 0.4));
  if (away <= 0) return crumpled;
  const target = straight(ROLL.x, 700, ROLL.x + 860, 700);
  return crumpled.map((v, i) => lerp(v, target[i], away));
}

function drawRoll(ctx, t) {
  const fade = 1 - smooth(seg(t, CARD_AT - 0.2, CARD_AT + 0.5));
  if (fade <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = fade;
  paperRect(ctx, ROLL.x, ROLL.y, ROLL.w, ROLL.h, 14, "#fffaf0", {
    dx: 4,
    dy: 8,
    alpha: 0.2,
  });
  ctx.beginPath();
  ctx.rect(ROLL.x, ROLL.y, ROLL.w, ROLL.h);
  ctx.save();
  ctx.clip();
  // Pitch rows.
  for (let m = 50; m <= 86; m += 1) {
    const black = [1, 3, 6, 8, 10].includes(m % 12);
    if (black) {
      ctx.fillStyle = "rgba(29,27,46,0.04)";
      ctx.fillRect(ROLL.x, pitchY(m) - 6.6, ROLL.w, 13);
    }
  }
  for (let m = 52; m <= 84; m += 12)
    lineSeg(ctx, ROLL.x, pitchY(m), ROLL.x + ROLL.w, pitchY(m), INK, 1.5, {
      opacity: 0.14,
    });
  // Beats scroll by.
  const first = Math.floor((t - (NOW_X - ROLL.x) / SPEED) / BEAT);
  for (let b = first; b <= Math.ceil(t / BEAT) + 2; b++) {
    const x = noteX(b * BEAT, t);
    lineSeg(ctx, x, ROLL.y, x, ROLL.y + ROLL.h, INK, b % 4 === 0 ? 2 : 1, {
      opacity: b % 4 === 0 ? 0.16 : 0.07,
    });
  }
  // The notes the loops have made.
  for (const e of EVENTS) {
    if (e.t > t + 0.01) break;
    const x = noteX(e.t, t);
    if (x < ROLL.x - 40) continue;
    const age = t - e.t;
    const pop = outBack(seg(age, 0, 0.25), 2.4);
    const color = COLORS[e.loop];
    ctx.save();
    ctx.translate(x, pitchY(e.midi));
    ctx.scale(pop, pop);
    paper(ctx, (c) => c.roundRect(-16, -9, 56, 18, 9), color, {
      dx: 2,
      dy: 3,
      alpha: 0.2,
    });
    ctx.restore();
  }
  // The cloud: notes that glimmer anywhere in the roll, written by "the model".
  for (const n of CLOUD) {
    const age = t - n.t;
    if (age < 0 || age > 1.6) continue;
    const x = ROLL.x + 40 + n.x * (ROLL.w - 140);
    const a = Math.sin(Math.PI * clamp(age / 1.6)) ** 0.7;
    fillCircle(ctx, x, pitchY(n.midi + 12), 7 + 6 * a, "#ff8a6a", 0.55 * a);
    fillCircle(ctx, x, pitchY(n.midi + 12), 3.5, "#ff5b3a", a);
  }
  ctx.restore();
  // "Now".
  lineSeg(ctx, NOW_X, ROLL.y, NOW_X, ROLL.y + ROLL.h, INK, 2.5, {
    opacity: 0.5,
  });
  ctx.restore();
}

function drawWheels(ctx, t) {
  const fade = 1 - smooth(seg(t, CARD_AT - 0.2, CARD_AT + 0.5));
  const centers = [
    [1230, 270],
    [1540, 270],
    [1230, 540],
    [1540, 540],
  ];
  const come = outCubic(seg(t, START - 0.4, START + 0.8));
  if (come <= 0 || fade <= 0.01) return;
  LOOPS.forEach((loop, i) => {
    const [cx, cy] = centers[i];
    const enter = outCubic(seg(t, loop.enters - 0.4, loop.enters + 0.6));
    if (enter <= 0) return;
    const R = 112;
    const period = loop.beats * BEAT;
    const turn = ((t - loop.enters) / period) % 1;
    const color = COLORS[loop.id];
    ctx.save();
    ctx.globalAlpha = fade * enter;
    ctx.translate(cx, cy);
    ctx.scale(0.8 + 0.2 * enter, 0.8 + 0.2 * enter);
    ctx.translate(-cx, -cy);
    paperCircle(ctx, cx, cy, R + 14, "#fffaf0", { dx: 4, dy: 8, alpha: 0.18 });
    ctx.strokeStyle = rgba(INK, 0.2);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    // Beat ticks.
    for (let b = 0; b < loop.beats; b++) {
      const a = (b / loop.beats) * Math.PI * 2 - Math.PI / 2;
      lineSeg(
        ctx,
        cx + Math.cos(a) * (R - 6),
        cy + Math.sin(a) * (R - 6),
        cx + Math.cos(a) * (R + 6),
        cy + Math.sin(a) * (R + 6),
        INK,
        2,
        { opacity: 0.25 },
      );
    }
    // Notes, as dots on the ring, and the hand that sweeps by them.
    loop.notes.forEach(([beat]) => {
      const a = (beat / loop.beats) * Math.PI * 2 - Math.PI / 2;
      const since = (((turn - beat / loop.beats) % 1) + 1) % 1;
      const hit = since < 0.06 ? 1 - since / 0.06 : 0;
      fillCircle(
        ctx,
        cx + Math.cos(a) * R,
        cy + Math.sin(a) * R,
        13 + 10 * hit,
        color,
        0.35 + 0.65 * hit,
      );
      if (hit > 0) {
        ctx.strokeStyle = rgba(color, hit);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(
          cx + Math.cos(a) * R,
          cy + Math.sin(a) * R,
          18 + 22 * (1 - hit),
          0,
          Math.PI * 2,
        );
        ctx.stroke();
      }
    });
    const a = turn * Math.PI * 2 - Math.PI / 2;
    lineSeg(
      ctx,
      cx,
      cy,
      cx + Math.cos(a) * (R - 8),
      cy + Math.sin(a) * (R - 8),
      INK,
      4,
      { opacity: 0.8 },
    );
    fillCircle(ctx, cx, cy, 6, INK);
    text(ctx, String(loop.beats), cx, cy + 52, {
      font: `italic 600 42px ${FONT.serif}`,
      color: INK,
      align: "center",
      opacity: 0.85,
      stroke: "#fffaf0",
      strokeWidth: 9,
    });
    text(ctx, "BEATS", cx, cy + 78, {
      font: `500 13px ${FONT.mono}`,
      color: INK,
      align: "center",
      tracking: 3,
      opacity: 0.55,
    });
    ctx.restore();
  });
  // A note on why they never settle.
  const note = smooth(seg(t, START + 3.2, START + 4.2)) * fade;
  text(ctx, "7  ·  11  ·  17  ·  13: they never line up", 1385, 706, {
    font: `italic 500 24px ${FONT.serif}`,
    color: INK,
    align: "center",
    opacity: 0.7 * note,
  });
}

function drawHandAndDust(ctx, t) {
  const gone = seg(t, 1.2, 2.8);
  if (gone >= 1) return;
  const hover = outCubic(seg(t, 0.0, 0.8));
  const crumble = seg(t, 1.2, 2.2);
  if (crumble < 1) {
    ctx.save();
    ctx.globalAlpha = 1 - smooth(seg(t, 1.2, 1.9));
    const dy = Math.sin(t * 2.2) * 4 + (1 - hover) * 160;
    drawHand(ctx, pose("open", "pluck", 0.2), {
      x: 600,
      y: 640 + dy,
      scale: 150,
      fill: SKIN,
      forearm: 3.2,
      sleeve: "#8b3a2a",
      rotate: 0,
    });
    ctx.restore();
  }
  // The paper pieces it becomes.
  if (t > 1.15) {
    const r = rng(31);
    for (let i = 0; i < 90; i++) {
      const sx = 480 + r() * 260;
      const sy = 340 + r() * 330;
      const vx = (r() - 0.35) * 380;
      const vy = -r() * 280 - 40;
      const size = 7 + r() * 11;
      const spin = (r() - 0.5) * 8;
      const age = t - 1.15 - r() * 0.25;
      if (age < 0) continue;
      const life = clamp(age / 1.6);
      const x = sx + vx * age;
      const y = sy + vy * age + 260 * age * age;
      ctx.save();
      ctx.globalAlpha = 1 - smooth(seg(life, 0.55, 1));
      ctx.translate(x, y);
      ctx.rotate(spin * age);
      ctx.fillStyle = i % 6 === 0 ? "#8b3a2a" : SKIN;
      ctx.fillRect(-size / 2, -size / 2, size, size);
      ctx.restore();
    }
  }
}

function drawCaret(ctx, t) {
  const show = smooth(seg(t, 0.4, 0.8)) * (1 - smooth(seg(t, 2.0, 2.6)));
  if (show <= 0) return;
  const on = Math.floor(t * 2) % 2 === 0;
  ctx.save();
  ctx.globalAlpha = show;
  if (on) lineSeg(ctx, NOW_X - 60, 420, NOW_X - 60, 480, INK, 4);
  text(ctx, "now what?", NOW_X - 270, 460, {
    font: `italic 500 44px ${FONT.serif}`,
    color: INK,
    opacity: 0.8,
  });
  ctx.restore();
}

function drawChecklist(ctx, t) {
  const come = outBack(seg(t, CARD_AT - 0.2, CARD_AT + 0.9), 1.15);
  if (come <= 0) return;
  const x = 150;
  const y = 150;
  const w = 880;
  ctx.save();
  ctx.translate(0, (1 - clamp(come, 0, 1.1)) * 140);
  ctx.globalAlpha = smooth(seg(t, CARD_AT - 0.2, CARD_AT + 0.5));
  paperRect(ctx, x, y, w, 500, 20, "#fffaf0", { dx: 6, dy: 12, alpha: 0.22 });
  text(ctx, "WHAT SOFTWARE CAN NOW SUPPLY", x + 40, y + 56, {
    font: `600 17px ${FONT.mono}`,
    color: INK,
    tracking: 4,
    opacity: 0.6,
  });
  const items = [
    ["Harmony", "the right chords"],
    ["Timing", "every note on the grid"],
    ["Arrangement", "what plays, and when"],
    ["Sound", "the instruments themselves"],
  ];
  items.forEach(([name, sub], i) => {
    const yy = y + 130 + i * 76;
    const at = CARD_AT + 0.8 + i * 0.75;
    paperRect(ctx, x + 40, yy - 34, 52, 52, 12, "transparent", {
      shadow: false,
      stroke: INK,
      lineWidth: 3,
      opacity: 0.5,
    });
    const p = seg(t, at, at + 0.45);
    if (p > 0)
      check(ctx, x + 66, yy - 8, 30, PALETTE.vermilion, outCubic(p), 7);
    text(ctx, name, x + 120, yy, {
      font: `600 38px ${FONT.serif}`,
      color: INK,
      opacity: 0.55 + 0.4 * smooth(p),
    });
    text(ctx, sub, x + 500, yy - 2, {
      font: `italic 500 24px ${FONT.serif}`,
      color: INK,
      opacity: 0.55,
    });
  });
  // The one box still empty: it pulses on the heartbeat.
  const yy = y + 130 + 4 * 76;
  const beat = (t / BEAT) % 1;
  const pulse = Math.exp(-beat * 4);
  paperRect(ctx, x + 40, yy - 34, 52, 52, 12, "transparent", {
    shadow: false,
    stroke: PALETTE.vermilion,
    lineWidth: 3 + 3 * pulse,
  });
  text(ctx, "What you mean", x + 120, yy, {
    font: `italic 600 38px ${FONT.serif}`,
    color: PALETTE.vermilion,
    opacity: smooth(seg(t, CARD_AT + 3.6, CARD_AT + 4.2)),
  });
  ctx.restore();
}

export default {
  bg: BG,
  ink: INK,
  lineColor: PALETTE.vermilion,
  captionAt: 2.8,
  ghostAlpha: 0.045,
  ghostY: 700,

  line: lineAt,
  lineStyle: (t) => ({ width: 6, opacity: smooth(seg(t, 0.3, 0.9)) }),

  back(ctx, t) {
    // The blank page, before anything is written.
    if (t < 3.0) {
      ctx.save();
      ctx.globalAlpha = 1 - smooth(seg(t, 2.2, 3.0));
      paperRect(ctx, ROLL.x, ROLL.y, ROLL.w, ROLL.h, 14, "#fffaf0", {
        dx: 4,
        dy: 8,
        alpha: 0.2,
      });
      for (let k = 0; k < 9; k++)
        lineSeg(
          ctx,
          ROLL.x + 10,
          ROLL.y + 40 + k * 50,
          ROLL.x + ROLL.w - 10,
          ROLL.y + 40 + k * 50,
          INK,
          1.5,
          { opacity: 0.1 },
        );
      ctx.restore();
    }
    drawRoll(ctx, t);
    drawWheels(ctx, t);
    drawChecklist(ctx, t);
  },

  front(ctx, t) {
    drawHandAndDust(ctx, t);
    drawCaret(ctx, t);
  },
};
