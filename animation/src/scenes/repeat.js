// 3. Repeat. A hand-cranked cylinder studded with pins plucks a steel comb; then its
// pattern becomes holes in a paper roll that a player piano reads, and the roll's grid of
// pitch against time is the one a modern editor still shows.

import {
  FONT,
  PALETTE,
  lineSeg,
  mix,
  paper,
  paperCircle,
  paperRect,
  rrectPath,
  text,
} from "../core/draw.js";
import { inOutCubic, lerp, outCubic, seg, smooth } from "../core/ease.js";
import { drawHand, pose } from "../core/hand.js";
import { morph, straight } from "../core/line.js";
import { arrow } from "../core/props.js";
import { repeatCue } from "../score.js";
import { byId } from "../timeline.js";

const C = byId.repeat;
const BG = "#1d6a68";
const CREAM = "#f4ead2";
const SKIN = "#f0c7a0";

const { cylinder, roll } = repeatCue();
const CYL = cylinder.map((e) => ({ ...e, t: e.t - C.start }));
const ROLL = roll.map((e) => ({ ...e, t: e.t - C.start }));

// ---- the cylinder
const DRUM = { x: 330, y: 340, w: 700, h: 240 };
const COMB_Y = DRUM.y;
const PITCHES = [...new Set(CYL.map((e) => e.midi))].sort((a, b) => a - b);
const toothX = (midi) => 380 + PITCHES.indexOf(midi) * 60;
const toothLen = (midi) => 104 - PITCHES.indexOf(midi) * 6;
const SPEED = 92; // px per second the pins travel up the drum's face
const SLIDE = [4.0, 5.4];

/** Where the cylinder group sits: centered at first, then tucked to the left. */
function cylinderTransform(t) {
  const p = inOutCubic(seg(t, ...SLIDE));
  return { dx: lerp(0, -340, p), dy: lerp(0, 24, p), s: lerp(1, 0.78, p) };
}
const applyCyl = (ctx, t) => {
  const { dx, dy, s } = cylinderTransform(t);
  ctx.translate(680 + dx, 460 + dy);
  ctx.scale(s, s);
  ctx.translate(-680, -460);
};
const cylPoint = (t, x, y) => {
  const { dx, dy, s } = cylinderTransform(t);
  return [680 + dx + (x - 680) * s, 460 + dy + (y - 460) * s];
};
// The cylinder retires once the roll takes over: time slows to a stop.
const cylTime = (t) =>
  t < 9.6 ? t : 9.6 + 0.25 * (1 - Math.exp(-(t - 9.6) / 0.25));

// ---- the roll and keyboard
const KEY_X0 = 880;
const WHITE = 44;
const TRACK_Y = 600;
const ROLL_SPEED = 200;
const LOWEST = 45;
const HIGHEST = 76;
const isBlack = (midi) => [1, 3, 6, 8, 10].includes(midi % 12);
const keys = (() => {
  const out = [];
  let whites = 0;
  for (let m = LOWEST; m <= HIGHEST; m++) {
    if (isBlack(m))
      out.push({ midi: m, black: true, x: KEY_X0 + whites * WHITE });
    else {
      out.push({
        midi: m,
        black: false,
        x: KEY_X0 + whites * WHITE + WHITE / 2,
      });
      whites++;
    }
  }
  return out;
})();
const KEYBOARD_W = keys.filter((k) => !k.black).length * WHITE;
const keyOf = (midi) => keys.find((k) => k.midi === midi);
const ROLL_COME = [4.2, 5.8];

const rollLine = () => straight(KEY_X0, TRACK_Y, KEY_X0 + KEYBOARD_W, TRACK_Y);
const combLine = (t) => {
  const [x0, y0] = cylPoint(t, DRUM.x, COMB_Y);
  const [x1, y1] = cylPoint(t, DRUM.x + DRUM.w, COMB_Y);
  return straight(x0, y0, x1, y1);
};

/** How strongly an event is sounding at time t (0 to 1, with a release). */
const pressed = (e, t) => (t >= e.t && t < e.t + e.dur ? 1 : 0);

function drawCylinder(ctx, t, alpha) {
  const ct = cylTime(t);
  ctx.save();
  ctx.globalAlpha *= alpha;
  applyCyl(ctx, t);
  // The drum: brass, shaded top to bottom as a cylinder is.
  const g = ctx.createLinearGradient(0, DRUM.y, 0, DRUM.y + DRUM.h);
  g.addColorStop(0, "#f0c969");
  g.addColorStop(0.35, "#d6a544");
  g.addColorStop(0.75, "#a97a2a");
  g.addColorStop(1, "#6e4f1b");
  paper(ctx, (c) => rrectPath(c, DRUM.x, DRUM.y, DRUM.w, DRUM.h, 26), g, {
    dx: 6,
    dy: 10,
  });
  // End caps and the axle toward the crank.
  paper(
    ctx,
    (c) =>
      c.ellipse(
        DRUM.x + 4,
        DRUM.y + DRUM.h / 2,
        30,
        DRUM.h / 2,
        0,
        0,
        Math.PI * 2,
      ),
    "#8c6522",
    { shadow: false },
  );
  paperRect(
    ctx,
    DRUM.x + DRUM.w,
    DRUM.y + DRUM.h / 2 - 12,
    62,
    24,
    6,
    "#6e4f1b",
    { shadow: false },
  );
  // Turning marks drift up the face.
  ctx.save();
  ctx.beginPath();
  rrectPath(ctx, DRUM.x + 34, DRUM.y, DRUM.w - 40, DRUM.h, 20);
  ctx.clip();
  for (let k = 0; k < 8; k++) {
    const y = DRUM.y + DRUM.h - ((k * 34 + ct * SPEED) % 272) + 20;
    lineSeg(ctx, DRUM.x, y, DRUM.x + DRUM.w, y, "#3b2a0c", 2, {
      opacity: 0.16,
    });
  }
  for (const midi of PITCHES)
    lineSeg(
      ctx,
      toothX(midi),
      DRUM.y,
      toothX(midi),
      DRUM.y + DRUM.h,
      "#3b2a0c",
      2,
      { opacity: 0.14 },
    );
  // Pins, scrolling up toward the comb.
  for (const e of CYL) {
    const y = COMB_Y + toothLen(e.midi) - (ct - e.t) * SPEED;
    if (y > DRUM.y + DRUM.h + 10 || y < DRUM.y - 12) continue;
    const melody = e.kind === "melody";
    paperCircle(
      ctx,
      toothX(e.midi),
      y,
      melody ? 10.5 : 9,
      melody ? "#fff6c9" : "#f6dd8b",
      { dx: 2, dy: 4, alpha: 0.4, stroke: "#7a5a1c", lineWidth: 2 },
    );
  }
  ctx.restore();
  drawCrank(ctx, t);
  // The comb: a steel strip with teeth that shorten as they rise in pitch.
  paperRect(ctx, DRUM.x + 20, COMB_Y - 12, DRUM.w - 30, 22, 6, "#cdd6da", {
    dx: 3,
    dy: 6,
  });
  for (const midi of PITCHES) {
    let wobble = 0;
    for (const e of CYL) {
      if (e.midi !== midi || ct < e.t || ct > e.t + 1.4) continue;
      wobble +=
        7 *
        Math.sin(2 * Math.PI * (7 + PITCHES.indexOf(midi) * 0.8) * (ct - e.t)) *
        Math.exp(-(ct - e.t) / 0.28);
    }
    const x = toothX(midi);
    const len = toothLen(midi);
    ctx.save();
    ctx.strokeStyle = "#e8eef0";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, COMB_Y + 6);
    ctx.lineTo(x + wobble, COMB_Y + len);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

/** The crank, turned by a hand that lets go once the roll takes over. Drawn in the cylinder's frame. */
function drawCrank(ctx, t) {
  const ct = cylTime(t);
  ctx.save();
  const turn = (2 * Math.PI * ct) / 4.8;
  const hub = [1100, 460];
  const arm = 78;
  const knob = [
    hub[0] + arm * Math.cos(turn - Math.PI / 2),
    hub[1] + arm * Math.sin(turn - Math.PI / 2),
  ];
  paperRect(ctx, hub[0] - 4, hub[1] - 14, 60, 28, 8, "#6e4f1b", {
    shadow: false,
  });
  ctx.save();
  ctx.strokeStyle = "#e0b552";
  ctx.lineWidth = 16;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(hub[0], hub[1]);
  ctx.lineTo(knob[0], knob[1]);
  ctx.stroke();
  ctx.restore();
  paperCircle(ctx, hub[0], hub[1], 22, "#cf9d3d");
  paperCircle(ctx, knob[0], knob[1], 17, "#f0c969");
  // The hand: a fist around the knob, arm coming in from the right, leaving at 6 s.
  const come = outCubic(seg(t, 0.2, 0.9));
  const leave = outCubic(seg(t, 6.0, 7.2));
  const scale = 96;
  const wrist = [
    knob[0] + 0.85 * scale + (1 - come) * 380 + leave * 520,
    knob[1] + 4,
  ];
  drawHand(ctx, pose("fist", "open", leave * 0.8), {
    x: wrist[0],
    y: wrist[1],
    scale,
    rotate: -Math.PI / 2,
    fill: SKIN,
    forearm: 2.6,
    sleeve: "#e8dfca",
  });
  ctx.restore();
}

function drawRoll(ctx, t) {
  const come = outCubic(seg(t, ...ROLL_COME));
  if (come <= 0) return;
  const paperTop = 150;
  const paperBottom = lerp(paperTop, TRACK_Y, come);
  const x0 = KEY_X0 - 6;
  const w = KEYBOARD_W + 12;
  ctx.save();
  // The paper hangs from a spool at the top; the spool is the old cylinder, grown thin.
  paperRect(ctx, x0, paperTop, w, paperBottom - paperTop, 4, "#efe3c6", {
    shadow: true,
  });
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, paperTop, w, paperBottom - paperTop);
  ctx.clip();
  // The grid, once it has been explained: a line for every beat, stronger at the bar.
  const gridAlpha = smooth(seg(t, 9.4, 10.6));
  if (gridAlpha > 0) {
    // The chapter starts on a bar line, so local beats are plain multiples of 0.6 s.
    for (let b = 0; b < 40; b++) {
      const y = TRACK_Y - (b * 0.6 - t) * ROLL_SPEED;
      if (y < paperTop || y > TRACK_Y) continue;
      const isBar = b % 4 === 0;
      lineSeg(ctx, x0, y, x0 + w, y, "#6b5636", isBar ? 2.5 : 1.2, {
        opacity: gridAlpha * (isBar ? 0.5 : 0.22),
      });
    }
    for (const k of keys.filter((q) => !q.black))
      lineSeg(
        ctx,
        k.x - WHITE / 2,
        paperTop,
        k.x - WHITE / 2,
        TRACK_Y,
        "#6b5636",
        1,
        { opacity: gridAlpha * 0.18 },
      );
  }
  // Holes: position is pitch, length is how long the note lasts.
  for (const e of ROLL) {
    const key = keyOf(e.midi);
    if (!key) continue;
    const yBottom = TRACK_Y - (e.t - t) * ROLL_SPEED;
    const yTop = yBottom - e.dur * ROLL_SPEED;
    if (yBottom < paperTop || yTop > TRACK_Y) continue;
    const width = key.black ? 18 : 24;
    const melody = e.kind === "melody";
    ctx.fillStyle = "#2a1e14";
    ctx.beginPath();
    rrectPath(ctx, key.x - width / 2, yTop, width, yBottom - yTop, 8);
    ctx.fill();
    if (melody) {
      ctx.strokeStyle = "#ff5b3a";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
  ctx.restore();
  // The spool.
  paperRect(ctx, x0 - 18, paperTop - 34, w + 36, 40, 18, "#cf9d3d", {
    dx: 4,
    dy: 7,
  });
  paperRect(ctx, x0 - 18, paperTop - 34, w + 36, 12, 12, "#f0c969", {
    shadow: false,
  });
  ctx.restore();
}

function drawKeys(ctx, t) {
  const come = outCubic(seg(t, ...ROLL_COME));
  if (come <= 0) return;
  ctx.save();
  ctx.translate(0, (1 - come) * 230);
  const active = new Map();
  for (const e of ROLL)
    if (pressed(e, t))
      active.set(
        e.midi,
        Math.max(active.get(e.midi) ?? 0, e.kind === "melody" ? 1 : 0.6),
      );
  const top = TRACK_Y + 12;
  for (const k of keys.filter((q) => !q.black)) {
    const down = active.get(k.midi) ?? 0;
    paper(
      ctx,
      (c) =>
        rrectPath(
          c,
          k.x - WHITE / 2 + 2,
          top + down * 7,
          WHITE - 4,
          144 - down * 7,
          6,
        ),
      mix("#fbf7ea", "#ff9b7f", down * 0.8),
      { dx: 2, dy: 4, alpha: 0.2 },
    );
  }
  for (const k of keys.filter((q) => q.black)) {
    const down = active.get(k.midi) ?? 0;
    paper(
      ctx,
      (c) => rrectPath(c, k.x - 14, top + down * 5, 28, 88 - down * 5, 5),
      mix("#1d1b2e", "#ff5b3a", down * 0.8),
      { dx: 2, dy: 4, alpha: 0.3 },
    );
  }
  ctx.restore();
}

export default {
  bg: BG,
  ink: CREAM,
  lineColor: PALETTE.vermilion,
  captionAt: 2.2,
  ghostAlpha: 0.06,
  ghostY: 700,

  line(t) {
    const p = inOutCubic(seg(t, ...SLIDE));
    return p <= 0
      ? combLine(t)
      : p >= 1
        ? rollLine()
        : morph(combLine(t), rollLine(), p);
  },
  lineStyle: () => ({ width: 7 }),

  back(ctx, t) {
    const retire = 1 - 0.62 * smooth(seg(t, 9.6, 10.6));
    drawCylinder(ctx, t, retire);
    drawRoll(ctx, t);
    drawKeys(ctx, t);

    // The grid, named.
    const label = smooth(seg(t, 10.2, 11.0));
    if (label > 0) {
      text(ctx, "PITCH", KEY_X0 + KEYBOARD_W, 796, {
        font: `500 15px ${FONT.mono}`,
        color: CREAM,
        align: "right",
        tracking: 4,
        opacity: label * 0.85,
      });
      arrow(
        ctx,
        KEY_X0 + KEYBOARD_W - 170,
        786,
        KEY_X0 + KEYBOARD_W - 84,
        786,
        CREAM,
        { opacity: label * 0.8 },
      );
      text(ctx, "TIME", KEY_X0 - 40, 360, {
        font: `500 15px ${FONT.mono}`,
        color: CREAM,
        align: "right",
        tracking: 4,
        opacity: label * 0.85,
      });
      arrow(ctx, KEY_X0 - 28, 380, KEY_X0 - 28, 490, CREAM, {
        opacity: label * 0.8,
      });
    }
    // The expression track: Welte-Mignon rolls kept touch and pedal as holes too.
    const exp = smooth(seg(t, 11.4, 12.2));
    if (exp > 0) {
      ctx.save();
      ctx.globalAlpha = exp;
      paperRect(ctx, 1742, 250, 162, 150, 10, "#efe3c6", { dx: 3, dy: 6 });
      text(ctx, "1904", 1760, 292, {
        font: `600 30px ${FONT.serif}`,
        color: "#2a1e14",
      });
      text(ctx, "WELTE-MIGNON", 1760, 322, {
        font: `600 13px ${FONT.mono}`,
        color: "#2a1e14",
        tracking: 1.5,
      });
      text(ctx, "touch and pedal,", 1760, 356, {
        font: `italic 500 19px ${FONT.serif}`,
        color: "#2a1e14",
      });
      text(ctx, "as holes too", 1760, 380, {
        font: `italic 500 19px ${FONT.serif}`,
        color: "#2a1e14",
      });
      ctx.restore();
    }
  },

  front() {},
};
