// 11. Play. Sway: two paper-cut hands in front of a camera, drawn after the instrument's own
// overlay. The right hand's height picks a rung on the pitch ladder and a pinch plays it
// (the amber trail is the Line, now the tune itself); the left hand's height conducts the
// band through AIR, PULSE, GROOVE, DRIVE, PEAK; a held pinch captures a loop; two fists end
// the piece. Everything follows the same script as the finale's audio.

import {
  FONT,
  fillCircle,
  lineSeg,
  paperCircle,
  paperRect,
  rgba,
  rrectPath,
  text,
} from "../core/draw.js";
import { clamp, lerp, outCubic, seg, smooth } from "../core/ease.js";
import { drawHand, drawSkeleton, place, pose } from "../core/hand.js";
import { resample, straight } from "../core/line.js";
import { LADDER, playScript } from "../score.js";
import { BEAT, byId } from "../timeline.js";

const C = byId.play;
const START_BEAT = C.startBar * 4;
const SCRIPT = playScript();
const NOTES = SCRIPT.notes;
const LEVELS = SCRIPT.levels;
const LEVEL_NAMES = ["AIR", "PULSE", "GROOVE", "DRIVE", "PEAK"];

// Sway's palette (web/instrument/style.css and overlay.js).
const LEAD = "#ffb547";
const BAND = "#4fd1c5";
const LOOP = "#ffd699";
const INK = "#f4f1ea";
const NOTE_LETTERS = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

// ---- geometry
const FRAME = { x: 56, y: 104, w: 1808, h: 696 };
const TOP = 160;
const BOTTOM = 770;
const NOW_R = 1330; // where the lead's "now" line sits; the past runs out to the right
const NOW_L = 590; // the band's, mirrored
const PER_BEAT = 148;
const rungY = (i) => BOTTOM - ((i + 0.5) * (BOTTOM - TOP)) / LADDER.length;
const zoneY = (level) => BOTTOM - ((level + 0.5) * (BOTTOM - TOP)) / 5;
const beatAt = (t) => START_BEAT + t / BEAT;
const xLead = (beat, now) => NOW_R + (now - beat) * PER_BEAT;
const xBand = (beat, now) => NOW_L - (now - beat) * PER_BEAT;

// ---- the performance, as state at a moment
const rungOf = (midi) => LADDER.indexOf(midi);
function noteAt(beat) {
  for (const n of NOTES) if (beat >= n.start && beat < n.end) return n;
  return null;
}
function lastNote(beat) {
  let last = null;
  for (const n of NOTES) if (n.start <= beat) last = n;
  return last;
}
function levelAt(beat) {
  let level = 0;
  for (const l of LEVELS) if (beat >= l.bar * 4) level = l.level;
  return level;
}
/** Where the band hand is: it rises a beat or two before the band follows. */
function askedLevel(beat) {
  let from = 0;
  let to = 0;
  let at = 0;
  for (const l of LEVELS) {
    const asked = l.asked ? l.asked[0] * 4 + l.asked[1] : l.bar * 4;
    if (beat >= asked) {
      from = to;
      to = l.level;
      at = asked;
    }
  }
  return lerp(from, to, smooth(clamp((beat - at) / 1.2)));
}
const chordName = (bar) =>
  (bar >= 84 ? ["F", "G", "Am", "C"] : ["Am", "F", "C", "G"])[
    ((bar % 4) + 4) % 4
  ];

const CAPTURE_BEAT = SCRIPT.capture.bar * 4 + SCRIPT.capture.beat;
const FISTS_BEAT = SCRIPT.fists.bar * 4 + SCRIPT.fists.beat;
const END_BEAT = SCRIPT.endBar * 4;
const HELD = SCRIPT.capture.held / BEAT;
const FIST_HELD = SCRIPT.fists.held / BEAT;

/** The notes the captured loop replays, from the capture on: (beat, midi, beats). */
const LOOP_NOTES = (() => {
  const cycle = 16;
  const from = CAPTURE_BEAT;
  const out = [];
  for (const n of NOTES) {
    if (n.start < from - cycle || n.start >= from) continue;
    const position = ((n.start % cycle) + cycle) % cycle;
    let at = Math.ceil((from - position) / cycle - 1e-9) * cycle + position;
    for (; at < END_BEAT + 8; at += cycle)
      out.push({ start: at, end: at + (n.end - n.start), midi: n.midi });
  }
  return out;
})();

// ---- the Line: the lead's trail, a continuous contour of the tune
function trailLine(t) {
  const now = beatAt(t);
  const recent = NOTES.filter((n) => n.start <= now && n.end > now - 3.2);
  const rest = rungY(Math.max(0, rungOf(lastNote(now)?.midi ?? 69)));
  if (!recent.length)
    return straight(NOW_R - 70, rungY(5), NOW_R + 30, rungY(5));
  const flat = [];
  let previous = null;
  for (const n of recent) {
    const y = rungY(rungOf(n.midi));
    const x0 = Math.min(1836, xLead(n.start, now));
    const x1 = Math.min(1836, xLead(Math.min(n.end, now), now));
    if (previous !== null) flat.push(x0, previous);
    flat.push(x0, y, Math.max(x0, x1) + 0.01, y);
    previous = y;
  }
  flat.push(NOW_R, rest);
  if (flat.length < 8) flat.push(NOW_R + 20, rest);
  return resample(flat);
}

// ---- drawing: stage, performer, UI
function drawStage(ctx, t) {
  ctx.save();
  ctx.beginPath();
  rrectPath(ctx, FRAME.x, FRAME.y, FRAME.w, FRAME.h, 28);
  ctx.clip();
  // A dim room, as the camera sees it.
  const g = ctx.createRadialGradient(960, 330, 60, 960, 420, 1100);
  g.addColorStop(0, "#14222e");
  g.addColorStop(0.5, "#0a131b");
  g.addColorStop(1, "#04070a");
  ctx.fillStyle = g;
  ctx.fillRect(FRAME.x, FRAME.y, FRAME.w, FRAME.h);
  // A window and a lamp: soft shapes so the room reads as a room.
  paperRect(ctx, 150, 170, 250, 330, 10, "#0e1b25", { shadow: false });
  for (const [x, y, w, h] of [
    [168, 188, 100, 140],
    [284, 188, 100, 140],
    [168, 346, 100, 136],
    [284, 346, 100, 136],
  ])
    paperRect(ctx, x, y, w, h, 4, "#13283a", { shadow: false });
  const lamp = ctx.createRadialGradient(1640, 250, 10, 1640, 250, 260);
  lamp.addColorStop(0, "rgba(255,200,120,0.16)");
  lamp.addColorStop(1, "rgba(255,200,120,0)");
  ctx.fillStyle = lamp;
  ctx.fillRect(1380, 20, 500, 480);
  paperCircle(ctx, 1640, 250, 26, "#3a3226", { shadow: false });
  // The performer: head, neck, and shoulders, faceless.
  const breathe = Math.sin(t * 1.3) * 3;
  ctx.fillStyle = "#17222d";
  ctx.beginPath();
  ctx.moveTo(430, 800);
  ctx.bezierCurveTo(470, 610 + breathe, 700, 530 + breathe, 860, 512 + breathe);
  ctx.lineTo(1060, 512 + breathe);
  ctx.bezierCurveTo(1220, 530 + breathe, 1450, 610 + breathe, 1490, 800);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#1b2833";
  ctx.fillRect(918, 430 + breathe, 84, 100);
  ctx.beginPath();
  ctx.ellipse(960, 372 + breathe, 80, 94, 0, 0, Math.PI * 2);
  ctx.fill();
  // The shade that darkens the side columns so labels stay readable.
  const shade = ctx.createLinearGradient(FRAME.x, 0, FRAME.x + FRAME.w, 0);
  shade.addColorStop(0, "rgba(7,9,11,0.7)");
  shade.addColorStop(0.1, "rgba(7,9,11,0.35)");
  shade.addColorStop(0.2, "rgba(7,9,11,0)");
  shade.addColorStop(0.8, "rgba(7,9,11,0)");
  shade.addColorStop(0.9, "rgba(7,9,11,0.35)");
  shade.addColorStop(1, "rgba(7,9,11,0.7)");
  ctx.fillStyle = shade;
  ctx.fillRect(FRAME.x, FRAME.y, FRAME.w, FRAME.h);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = "rgba(132,170,190,0.16)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  rrectPath(ctx, FRAME.x, FRAME.y, FRAME.w, FRAME.h, 28);
  ctx.stroke();
  ctx.restore();
}

function drawBeatLines(ctx, t, now, side) {
  const x = side === "lead" ? (b) => xLead(b, now) : (b) => xBand(b, now);
  const inner = side === "lead" ? 1018 : 902;
  const outer = side === "lead" ? 1840 : 80;
  for (let b = Math.floor(now - 6); b <= now + 3; b++) {
    const px = x(b);
    if (px < Math.min(inner, outer) || px > Math.max(inner, outer)) continue;
    const bar = b % 4 === 0;
    lineSeg(ctx, px, TOP - 14, px, BOTTOM + 14, INK, bar ? 1.5 : 1, {
      opacity: bar ? 0.16 : 0.06,
    });
  }
  const nowX = side === "lead" ? NOW_R : NOW_L;
  const pulse = 1 - (now - Math.floor(now));
  lineSeg(ctx, nowX, TOP - 24, nowX, BOTTOM + 24, INK, 2.5, {
    opacity: 0.35 + 0.35 * pulse ** 3,
  });
}

function drawLadder(ctx, t, now, uiAlpha) {
  const current = noteAt(now);
  const barChordPcs = { Am: [9, 0, 4], F: [5, 9, 0], C: [0, 4, 7], G: [7, 2] }[
    chordName(Math.floor(now / 4))
  ];
  const rowH = (BOTTOM - TOP) / LADDER.length;
  ctx.save();
  ctx.globalAlpha = uiAlpha;
  LADDER.forEach((midi, i) => {
    const y = rungY(i);
    const live = current && rungOf(current.midi) === i;
    const tone = barChordPcs.includes(midi % 12);
    if (live) {
      ctx.fillStyle = rgba(LEAD, 0.2);
      ctx.fillRect(1018, y - rowH / 2, 822, rowH);
    }
    lineSeg(ctx, 1018, y, 1840, y, INK, 1.2, { opacity: tone ? 0.3 : 0.12 });
    text(ctx, NOTE_LETTERS[midi % 12], 1860, y, {
      font: `${tone ? 700 : 500} 20px ${FONT.sans}`,
      color: live ? LEAD : INK,
      align: "right",
      baseline: "middle",
      opacity: tone || live ? 0.95 : 0.5,
    });
  });
  // Captured loop notes: thin pale lines, replaying every four bars.
  for (const n of LOOP_NOTES) {
    const x0 = xLead(n.start, now);
    const x1 = xLead(n.end, now);
    if (x0 < 1018 - 10 || x1 > 1860 + 100) continue;
    const y = rungY(rungOf(n.midi));
    ctx.save();
    ctx.globalAlpha =
      uiAlpha * 0.55 * smooth(seg(now, CAPTURE_BEAT, CAPTURE_BEAT + 0.4));
    ctx.strokeStyle = LOOP;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(Math.min(x0, x1), y);
    ctx.lineTo(Math.max(x0, x1), y);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function drawEnergy(ctx, t, now, uiAlpha) {
  const level = levelAt(now);
  const zone = (BOTTOM - TOP) / 5;
  ctx.save();
  ctx.globalAlpha = uiAlpha;
  for (let l = 0; l < 5; l++) {
    const y = zoneY(l);
    const playing = l <= level;
    ctx.fillStyle = rgba(BAND, l === Math.round(askedLevel(now)) ? 0.1 : 0);
    ctx.fillRect(80, y - zone / 2, 822, zone);
    lineSeg(ctx, 80, y - zone / 2, 902, y - zone / 2, INK, 1, { opacity: 0.1 });
    text(ctx, LEVEL_NAMES[l], 84, y, {
      font: `${playing ? 700 : 500} 18px ${FONT.sans}`,
      color: playing ? BAND : INK,
      baseline: "middle",
      tracking: 2,
      opacity: playing ? 0.95 : 0.4,
    });
  }
  // Energy history: a step per bar, filled underneath.
  ctx.fillStyle = rgba(BAND, 0.08);
  ctx.strokeStyle = rgba(BAND, 0.9);
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  const firstBar = Math.floor(now / 4) - 6;
  for (let bar = firstBar; bar <= Math.floor(now / 4); bar++) {
    const lv = levelAt(bar * 4);
    const x0 = Math.max(190, xBand(bar * 4, now));
    const x1 = Math.min(NOW_L, xBand(Math.min((bar + 1) * 4, now), now));
    if (x1 <= x0) continue;
    const y = BOTTOM - (lv + 1) * zone;
    ctx.fillRect(x0, y, x1 - x0, BOTTOM - y);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBeatAndChord(ctx, t, now, uiAlpha) {
  const bar = Math.floor(now / 4);
  const beat = Math.floor(now % 4);
  ctx.save();
  ctx.globalAlpha = uiAlpha;
  text(ctx, "NIGHT DRIVE  ·  A MINOR  ·  100 BPM", 960, 138, {
    font: `500 14px ${FONT.mono}`,
    color: INK,
    align: "center",
    tracking: 3,
    opacity: 0.45,
  });
  for (let b = 0; b < 4; b++)
    fillCircle(
      ctx,
      920 + b * 27,
      170,
      b === beat ? 8 : 5,
      b === beat ? LEAD : INK,
      b === beat ? 1 : 0.3,
    );
  const chord = chordName(bar);
  const age = (now % 4) / 4;
  text(ctx, chord, 960, 232, {
    font: `600 64px ${FONT.serif}`,
    color: INK,
    align: "center",
    opacity: 0.9 - 0.15 * age,
  });
  ctx.restore();
}

function drawBandChips(ctx, t, now, uiAlpha) {
  const chips = [
    ["PAD", 0],
    ["KICK", 1],
    ["SHAKER", 1],
    ["BASS", 1],
    ["SNARE", 2],
    ["HATS", 2],
    ["KEYS", 2],
    ["OPEN HAT", 3],
    ["CLAP", 4],
    ["ARP", 4],
  ];
  const level = levelAt(now);
  ctx.save();
  ctx.globalAlpha = uiAlpha;
  let x = 560;
  const y = 752;
  for (const [name, at] of chips) {
    const on = level >= at;
    const w = 24 + name.length * 11;
    paperRect(
      ctx,
      x,
      y - 16,
      w,
      32,
      16,
      on ? rgba(BAND, 0.22) : "transparent",
      { shadow: false, stroke: on ? BAND : rgba(INK, 0.25), lineWidth: 2 },
    );
    text(ctx, name, x + w / 2, y + 5, {
      font: `600 14px ${FONT.mono}`,
      color: on ? BAND : INK,
      align: "center",
      tracking: 1,
      opacity: on ? 1 : 0.45,
    });
    x += w + 10;
  }
  ctx.restore();
}

// ---- the hands
const HAND_SCALE = 124;

/** Where both hands are at this moment, and how they are posed. */
function handState(t, now) {
  const comeBand = outCubic(seg(t, 0.8, 2.0));
  const comeLead = outCubic(seg(t, 2.0, 3.2));
  const fistMix = smooth(seg(now, FISTS_BEAT, FISTS_BEAT + 0.4));
  const down = Boolean(noteAt(now));
  const note = noteAt(now) ?? lastNote(now);
  const rung = rungOf(note?.midi ?? 69);

  // Lead hand (right): the pinch point sits on the chosen rung.
  const leadPose = pose(pose("open", "pinch", down ? 1 : 0), "fist", fistMix);
  const probe = place(leadPose, { x: 0, y: 0, scale: HAND_SCALE });
  const mid = [
    (probe[4][0] + probe[8][0]) / 2,
    (probe[4][1] + probe[8][1]) / 2,
  ];
  const lx = 1450 + 10 * Math.sin(t * 0.9) + (1 - comeLead) * 360;
  const ly = rungY(rung) + (1 - comeLead) * 260;

  // Band hand (left): its height is the energy; a held pinch captures a loop; a fist ends.
  const level = askedLevel(now);
  const capturing = now > CAPTURE_BEAT - HELD && now < CAPTURE_BEAT + 0.5;
  const bandMix = capturing
    ? smooth(seg(now, CAPTURE_BEAT - HELD - 0.3, CAPTURE_BEAT - HELD))
    : 0;
  const bandPose = pose(pose("open", "pinch", bandMix), "fist", fistMix);
  const bprobe = place(bandPose, {
    x: 0,
    y: 0,
    scale: HAND_SCALE,
    mirror: true,
  });
  const center = bprobe[9];
  const bx = 470 + 8 * Math.sin(t * 0.7 + 1) - (1 - comeBand) * 360;
  const by = zoneY(level) + (1 - comeBand) * 260;
  return {
    comeLead,
    comeBand,
    down,
    rung,
    level,
    capturing,
    lead: { pose: leadPose, x: lx - mid[0], y: ly - mid[1], cursor: [lx, ly] },
    band: {
      pose: bandPose,
      x: bx - center[0],
      y: by - center[1],
      cursor: [bx, by],
    },
  };
}

function drawHandBodies(ctx, t, now) {
  const h = handState(t, now);
  // The camera crops whatever leaves its frame.
  ctx.save();
  ctx.beginPath();
  rrectPath(ctx, FRAME.x, FRAME.y, FRAME.w, FRAME.h, 28);
  ctx.clip();
  drawHand(ctx, h.lead.pose, {
    x: h.lead.x,
    y: h.lead.y,
    scale: HAND_SCALE,
    fill: "#b48f74",
    forearm: 3.6,
    sleeve: "#2c3a48",
    shadow: false,
  });
  drawHand(ctx, h.band.pose, {
    x: h.band.x,
    y: h.band.y,
    scale: HAND_SCALE,
    mirror: true,
    fill: "#a98368",
    forearm: 3.6,
    sleeve: "#2c3a48",
    shadow: false,
  });
  ctx.restore();
}

/** The skeletons, cursors, and the capture ring: drawn over the tune's trail. */
function drawHandOverlays(ctx, t, now) {
  const h = handState(t, now);
  const lead = place(h.lead.pose, {
    x: h.lead.x,
    y: h.lead.y,
    scale: HAND_SCALE,
  });
  drawSkeleton(ctx, lead, { color: LEAD, alpha: 0.75, width: 2 });
  const [lx, ly] = h.lead.cursor;
  const pinched = h.down ? 1 : 0;
  ctx.save();
  ctx.globalAlpha = h.comeLead;
  lineSeg(ctx, lx, ly, NOW_R, rungY(h.rung), LEAD, pinched ? 3 : 1.6, {
    opacity: pinched ? 0.9 : 0.45,
  });
  paperCircle(ctx, lx, ly, 14, pinched ? rgba(LEAD, 0.9) : rgba(LEAD, 0.12), {
    shadow: false,
    stroke: LEAD,
    lineWidth: 2.4,
  });
  fillCircle(ctx, NOW_R, rungY(h.rung), pinched ? 9 : 5, LEAD);
  ctx.restore();

  const band = place(h.band.pose, {
    x: h.band.x,
    y: h.band.y,
    scale: HAND_SCALE,
    mirror: true,
  });
  drawSkeleton(ctx, band, { color: BAND, alpha: 0.75, width: 2 });
  const [bx, by] = h.band.cursor;
  ctx.save();
  ctx.globalAlpha = h.comeBand;
  lineSeg(ctx, bx, by, NOW_L, zoneY(h.level), BAND, 1.6, { opacity: 0.55 });
  paperCircle(ctx, bx, by, 14, rgba(BAND, 0.12), {
    shadow: false,
    stroke: BAND,
    lineWidth: 2.4,
  });
  fillCircle(ctx, NOW_L, zoneY(h.level), 5, BAND);
  if (h.capturing) {
    const p = clamp((now - (CAPTURE_BEAT - HELD)) / HELD);
    ctx.strokeStyle = rgba(LOOP, 0.25);
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(bx, by, 34, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = LOOP;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(bx, by, 34, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawEndRing(ctx, now) {
  if (now < FISTS_BEAT) return;
  const p = clamp((now - FISTS_BEAT) / FIST_HELD);
  const x = 960;
  const y = 640;
  ctx.save();
  ctx.strokeStyle = rgba(INK, 0.2);
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(x, y, 40, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = INK;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(x, y, 40, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
  ctx.stroke();
  text(ctx, "TWO FISTS END THE PIECE", x, y + 76, {
    font: `600 14px ${FONT.mono}`,
    color: INK,
    align: "center",
    tracking: 3,
    opacity: 0.8 * smooth(seg(now, FISTS_BEAT, FISTS_BEAT + 0.3)),
  });
  ctx.restore();
}

function drawLoopChip(ctx, now) {
  const p = smooth(seg(now, CAPTURE_BEAT, CAPTURE_BEAT + 0.4));
  if (p <= 0) return;
  ctx.save();
  ctx.globalAlpha = p;
  paperRect(ctx, 1430, 128, 190, 36, 18, rgba(LOOP, 0.18), {
    shadow: false,
    stroke: LOOP,
    lineWidth: 2,
  });
  text(ctx, "LOOP  ·  LAYER 1", 1525, 152, {
    font: `600 14px ${FONT.mono}`,
    color: LOOP,
    align: "center",
    tracking: 2,
  });
  ctx.restore();
}

export default {
  bg: "#07090b",
  ink: INK,
  lineColor: LEAD,
  captionAt: 2.4,
  ghost: false,

  line: trailLine,
  lineStyle: () => ({ width: 10, shadow: false }),

  back(ctx, t) {
    const now = beatAt(t);
    const ui = smooth(seg(t, 0.4, 1.4));
    drawStage(ctx, t);
    drawBeatLines(ctx, t, now, "lead");
    drawBeatLines(ctx, t, now, "band");
    drawLadder(ctx, t, now, ui);
    drawEnergy(ctx, t, now, ui);
    drawBeatAndChord(ctx, t, now, ui);
    drawBandChips(ctx, t, now, ui);
    drawLoopChip(ctx, now);
    drawHandBodies(ctx, t, now);
  },

  front(ctx, t) {
    const now = beatAt(t);
    drawHandOverlays(ctx, t, now);
    drawEndRing(ctx, now);
  },
};
