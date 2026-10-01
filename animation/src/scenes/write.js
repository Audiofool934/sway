// 2. Write. A scribe's quill inks the tune onto a four-line staff while a bouncing ball
// sings it in ut-re-mi syllables; a medieval "Guidonian" hand lights the joint for each pitch.

import {
  FONT,
  PALETTE,
  fillCircle,
  lineSeg,
  mix,
  paper,
  paperCircle,
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
import { drawHand, place, pose } from "../core/hand.js";
import { straight } from "../core/line.js";
import { cues } from "../score.js";
import { byId } from "../timeline.js";

const C = byId.write;
const INK = "#2b2118";
const FADED = "#4a3624";
const SKIN = "#f0c7a0";

// Diatonic steps above C4, and the staff: lines on G, B, D, F (the top one is the Line).
const STEP = { 67: 4, 69: 5, 72: 7, 74: 8, 76: 9 };
const HALF = 34;
const yOf = (midi) => 534 - (STEP[midi] - 4) * HALF;
const LINE_Y = [330, 398, 466, 534];
const STAFF_X0 = 110;
const STAFF_X1 = 1260;
const NOTE_X = (i) => 270 + 75 * i;

const NOTES = cues.write.notes.map((n) => ({
  ...n,
  t: n.t - C.start,
  x: NOTE_X(n.index),
  y: yOf(n.midi),
}));
const WRITE_START = 0.6;
const WRITE_STEP = 0.14;
const written = (i) => WRITE_START + 0.1 + i * WRITE_STEP;

// The Guidonian hand: where each pitch sits on it.
const HAND = { x: 1520, y: 770, scale: 240 };
const JOINT = { 67: 4, 69: 5, 72: 9, 74: 13, 76: 17 };
const handPoints = (offset = 0) =>
  place(pose("open"), {
    x: HAND.x + offset,
    y: HAND.y,
    scale: HAND.scale,
    mirror: true,
  });

/** Where the quill's nib is at time t, and whether it is down. */
function nibAt(t) {
  const first = NOTES[0];
  const last = NOTES.at(-1);
  const start = [1560, 150];
  const arrive = outCubic(seg(t, 0, WRITE_START + 0.1));
  if (t < written(0))
    return [
      lerp(start[0], first.x, arrive),
      lerp(start[1], first.y, arrive) - (1 - arrive) * 40,
    ];
  const tEnd = written(NOTES.length - 1);
  if (t >= tEnd) {
    const away = inOutCubic(seg(t, tEnd + 0.15, tEnd + 1.0));
    return [lerp(last.x, 1500, away), lerp(last.y, 130, away)];
  }
  const f = (t - written(0)) / WRITE_STEP;
  const i = Math.min(NOTES.length - 2, Math.floor(f));
  const k = f - i;
  const u = outCubic(clamp(k * 1.6));
  const a = NOTES[i];
  const b = NOTES[i + 1];
  return [
    lerp(a.x, b.x, u),
    lerp(a.y, b.y, u) - 26 * Math.sin(Math.PI * clamp(k * 1.6)),
  ];
}

function drawQuill(ctx, nx, ny, opacity) {
  // A feather leaning up and to the right; the nib is at (nx, ny).
  const angle = -Math.PI / 3.1;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const px = -uy;
  const py = ux;
  const at = (along, across = 0) => [
    nx + ux * along + px * across,
    ny + uy * along + py * across,
  ];
  ctx.save();
  ctx.globalAlpha *= opacity;
  paper(
    ctx,
    (c) => {
      const [a0, a1] = at(130);
      c.moveTo(a0, a1);
      const [t0, t1] = at(430);
      const [c1x, c1y] = at(250, -70);
      const [c2x, c2y] = at(380, -62);
      c.bezierCurveTo(c1x, c1y, c2x, c2y, t0, t1);
      const [d1x, d1y] = at(380, 40);
      const [d2x, d2y] = at(250, 54);
      c.bezierCurveTo(d1x, d1y, d2x, d2y, a0, a1);
      c.closePath();
    },
    "#f6efe0",
    { dx: 4, dy: 7 },
  );
  lineSeg(ctx, ...at(0), ...at(380), "#8a6a45", 5);
  fillCircle(ctx, nx, ny, 3.5, INK);
  ctx.restore();
}

export default {
  bg: PALETTE.parchment,
  ink: INK,
  lineColor: PALETTE.vermilion,
  captionAt: 2.6,
  ghostAlpha: 0.075,
  ghostY: 720,

  // The red F line of the staff.
  line: () => straight(STAFF_X0, LINE_Y[0], STAFF_X1, LINE_Y[0]),
  lineStyle: () => ({ width: 6 }),

  back(ctx, t) {
    // A manuscript border.
    ctx.save();
    ctx.strokeStyle = rgba(INK, 0.22);
    ctx.lineWidth = 2;
    ctx.strokeRect(44, 44, 1832, 992);
    ctx.strokeRect(54, 54, 1812, 972);
    ctx.restore();

    // The other three staff lines draw in from the left.
    LINE_Y.slice(1).forEach((y, i) => {
      const p = outCubic(seg(t, 0.35 + i * 0.12, 1.15 + i * 0.12));
      lineSeg(
        ctx,
        STAFF_X0,
        y,
        STAFF_X0 + (STAFF_X1 - STAFF_X0) * p,
        y,
        FADED,
        3,
      );
    });

    // Notes: square neumes, popping in where the quill touches, lighting as they are sung.
    NOTES.forEach((n, i) => {
      const w = written(i);
      const pop = outBack(seg(t, w, w + 0.28), 2.4);
      if (pop <= 0) return;
      const sung =
        outCubic(seg(t, n.t, n.t + 0.1)) *
        (1 - smooth(seg(t, n.t + n.dur * 0.85, n.t + n.dur + 0.3)));
      const size = (1 + 0.32 * sung) * pop;
      const color = mix(INK, "#ff5b3a", sung);
      ctx.save();
      ctx.translate(n.x, n.y);
      ctx.scale(size, size);
      paper(ctx, (c) => rrectPath(c, -19, -16, 38, 32, 5), color, {
        dx: 2,
        dy: 4,
        alpha: 0.2,
      });
      ctx.restore();
      // The syllable sung on this note.
      const s = smooth(seg(t, n.t - 0.05, n.t + 0.2));
      text(ctx, n.syllable, n.x, 640 + (1 - s) * 10, {
        font: `italic 500 32px ${FONT.serif}`,
        color: INK,
        align: "center",
        opacity: s * 0.9,
      });
    });

    // The Guidonian hand: a diagram, in sand and ink, with a dot on every joint.
    const come = outCubic(seg(t, 0.9, 2.0));
    if (come > 0) {
      const dx = (1 - come) * 460;
      drawHand(ctx, pose("open"), {
        x: HAND.x + dx,
        y: HAND.y,
        scale: HAND.scale,
        mirror: true,
        fill: "#dcc18d",
        outline: INK,
        outlineWidth: 7,
        shadow: false,
        forearm: 0.55,
        sleeve: "#6b4a2d",
        opacity: come,
      });
      const pts = handPoints(dx);
      pts
        .slice(1)
        .forEach(([px, py], k) =>
          fillCircle(
            ctx,
            px,
            py,
            5,
            FADED,
            come * smooth(seg(t, 1.3 + k * 0.03, 1.8 + k * 0.03)),
          ),
        );
      Object.entries(JOINT).forEach(([midi, id], k) => {
        const [px, py] = pts[id];
        const label = smooth(seg(t, 1.8 + k * 0.12, 2.3 + k * 0.12));
        const syllable = { 67: "Sol", 69: "La", 72: "Ut", 74: "Re", 76: "Mi" }[
          midi
        ];
        const hit = NOTES.filter((n) => n.midi === Number(midi)).reduce(
          (m, n) =>
            Math.max(
              m,
              outCubic(seg(t, n.t, n.t + 0.1)) *
                (1 - smooth(seg(t, n.t + n.dur * 0.85, n.t + n.dur + 0.3))),
            ),
          0,
        );
        fillCircle(ctx, px, py, 10 + 5 * hit, mix(INK, "#ff5b3a", hit), label);
        if (hit > 0.02) {
          ctx.save();
          ctx.strokeStyle = rgba("#ff5b3a", 0.6 * hit);
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(px, py, 18 + 16 * (1 - hit), 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        const sx =
          Number(midi) === 67 ? px + 44 : Number(midi) === 76 ? px - 26 : px;
        const sy =
          Number(midi) === 67
            ? py + 8
            : Number(midi) === 76
              ? py + 46
              : py + 64;
        text(ctx, syllable, sx, sy, {
          font: `italic 600 30px ${FONT.serif}`,
          color: INK,
          align: "center",
          opacity: label,
        });
      });
    }
  },

  front(ctx, t) {
    // The bouncing ball, resting above the sounding note and hopping to the next.
    const first = NOTES[0].t - 0.4;
    if (t > first - 0.5 && t < NOTES.at(-1).t + NOTES.at(-1).dur + 0.6) {
      let k = 0;
      NOTES.forEach((n, i) => {
        if (t >= n.t - 0.28) k = i;
      });
      const a = NOTES[Math.max(0, k)];
      const b = NOTES[Math.min(NOTES.length - 1, k + 1)];
      const leap = k < NOTES.length - 1 ? clamp((t - (b.t - 0.28)) / 0.28) : 0;
      const hop = k === 0 && t < NOTES[0].t - 0.28 ? 0 : 1;
      const x = lerp(a.x, b.x, inOutCubic(leap));
      const y =
        lerp(a.y, b.y, inOutCubic(leap)) - 52 - 52 * Math.sin(Math.PI * leap);
      const fade =
        smooth(seg(t, first - 0.5, first)) *
        (1 -
          smooth(
            seg(
              t,
              NOTES.at(-1).t + NOTES.at(-1).dur,
              NOTES.at(-1).t + NOTES.at(-1).dur + 0.6,
            ),
          ));
      ctx.save();
      ctx.globalAlpha = fade * hop;
      paperCircle(ctx, x, y, 12, PALETTE.brass, { dx: 2, dy: 4 });
      ctx.restore();
    }

    // The thread from the sounding joint to its note: the same pitch, written and on the hand.
    const pts = handPoints(0);
    for (const n of NOTES) {
      const life =
        outCubic(seg(t, n.t, n.t + 0.08)) *
        (1 - smooth(seg(t, n.t + 0.25, n.t + 0.7)));
      if (life < 0.02 || t < 2.0) continue;
      const [jx, jy] = pts[JOINT[n.midi]];
      ctx.save();
      ctx.strokeStyle = rgba("#ff5b3a", 0.8 * life);
      ctx.lineWidth = 3.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(jx - 14, jy - 8);
      ctx.bezierCurveTo(
        jx - 260,
        jy - 340,
        n.x + 220,
        n.y - 330,
        n.x + 22,
        n.y - 6,
      );
      ctx.stroke();
      ctx.restore();
    }

    // The scribe's quill and the hand that holds it.
    const [nx, ny] = nibAt(t);
    const present =
      1 -
      smooth(
        seg(
          t,
          written(NOTES.length - 1) + 0.9,
          written(NOTES.length - 1) + 1.1,
        ),
      );
    if (present > 0.01) {
      drawQuill(ctx, nx, ny, present);
      // Grip on the shaft, 150 px up from the nib.
      const angle = -Math.PI / 3.1;
      const grip = [nx + Math.cos(angle) * 150, ny + Math.sin(angle) * 150];
      const scale = 120;
      const rotate = Math.PI + Math.PI / 6;
      const hand = pose("open", "pluck", 1);
      const probe = place(hand, { x: 0, y: 0, scale, rotate });
      const pinch = [
        (probe[4][0] + probe[8][0]) / 2,
        (probe[4][1] + probe[8][1]) / 2,
      ];
      ctx.save();
      ctx.globalAlpha = present;
      drawHand(ctx, hand, {
        x: grip[0] - pinch[0],
        y: grip[1] - pinch[1],
        scale,
        rotate,
        fill: SKIN,
        forearm: true,
        sleeve: "#8b3a2a",
      });
      ctx.restore();
    }
  },
};
