// 1. Vibrate. A hand plucks a string; the title; a monochord whose movable bridge makes
// the octave, fifth, and fourth (pure ratios); then the string's own overtones, stacked.

import {
  FONT,
  PALETTE,
  lineSeg,
  paper,
  paperCircle,
  paperRect,
  text,
  rgba,
  fillCircle,
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
import { wave } from "../core/line.js";
import { rng } from "../core/rand.js";
import { cues } from "../score.js";
import { byId } from "../timeline.js";

const C = byId.vibrate;
const local = (global) => global - C.start;
const X0 = 300;
const X1 = 1620;
const L = X1 - X0;
const Y = 430;
const AMP = 62;
const SKIN = "#f0c7a0";
const SLEEVE = "#e8dfca";

const { pluck, intervals, harmonics, monochord, title } = cues.vibrate;
const SLIDES = intervals.map((iv) => ({
  slide: local(iv.slide),
  pluck: local(iv.pluck),
  f: iv.length,
  name: iv.name,
  ratio: iv.ratio,
}));
const PLUCKS = [
  { t: local(pluck), f: 1, until: SLIDES[0].slide },
  ...SLIDES.map((s, i) => ({
    t: s.pluck,
    f: s.f,
    until: SLIDES[i + 1]?.slide ?? local(harmonics[0].t) - 0.4,
  })),
];
const HARMONICS = harmonics.map((h) => ({ n: h.n, t: local(h.t) }));
const BRIDGE_HOME = local(harmonics[0].t) - 0.4;
const NOTES = {
  octave: ["A3", "220 Hz"],
  fifth: ["E3", "165 Hz"],
  fourth: ["D3", "147 Hz"],
};
const COMPONENT_COLORS = [
  PALETTE.mustard,
  PALETTE.sky,
  PALETTE.mint,
  PALETTE.blush,
  PALETTE.sage,
];

/** Where the movable bridge sits, as a fraction of the string. */
function bridge(t) {
  let f = 1;
  for (const s of SLIDES)
    f = lerp(f, s.f, inOutCubic(seg(t, s.slide, s.pluck)));
  return lerp(f, 1, inOutCubic(seg(t, BRIDGE_HOME, BRIDGE_HOME + 0.45)));
}

/** The plucked-string shape: modes of a string plucked at its middle (odd modes only). */
function pluckedShape(u, since, f, until, t) {
  const damp = 1 - smooth(seg(t, until, until + 0.28));
  const base = 3 / f; // slowed way down so the eye can follow it
  let y = 0;
  for (const m of [1, 3, 5]) {
    const a =
      ((8 * AMP) / (Math.PI ** 2 * m * m)) * Math.sin((m * Math.PI) / 2);
    const decay = Math.exp(-since / (2.1 / (1 + 0.55 * (m - 1))));
    y +=
      a *
      Math.sin(m * Math.PI * u) *
      Math.cos(2 * Math.PI * m * base * since) *
      decay;
  }
  return y * damp;
}

/** The pulled-up string, before it is let go: two straight lengths meeting at the finger. */
const pulledShape = (u, height) =>
  u < 0.5 ? height * (u / 0.5) : height * ((1 - u) / 0.5);

function displacement(u, t) {
  for (const p of PLUCKS) {
    const pull = clamp((t - (p.t - 0.7)) / 0.7);
    if (t >= p.t - 0.7 && t < p.t) return pulledShape(u, AMP * smooth(pull));
    if (t >= p.t && t < p.until + 0.3)
      return pluckedShape(u, t - p.t, p.f, p.until, t);
  }
  return 0;
}

/** The harmonics section: a sum of overtones of the whole string. */
function overtones(t) {
  const fade = 1 - smooth(seg(t, 17.5, 19.0));
  return HARMONICS.map((h, i) => {
    const age = t - h.t;
    const level =
      age < 0 ? 0 : smooth(clamp(age / 0.35)) * Math.exp(-Math.max(0, age) / 6);
    return { n: h.n, level: level * fade, color: COMPONENT_COLORS[i], age };
  });
}
const COMPONENT_AMP = { 1: 40, 2: 28, 3: 22, 4: 16, 6: 10 };

function modeShape(u, mode, age) {
  return (
    COMPONENT_AMP[mode.n] *
    mode.level *
    Math.sin(mode.n * Math.PI * u) *
    Math.cos(2 * Math.PI * mode.n * 2 * Math.max(0, age))
  );
}

const inHarmonics = (t) => t >= HARMONICS[0].t - 0.2;

function lineAt(t) {
  const f = bridge(t);
  if (inHarmonics(t)) {
    const modes = overtones(t);
    return wave(
      X0,
      X1,
      (u) => Y - modes.reduce((sum, m) => sum + modeShape(u, m, m.age), 0),
    );
  }
  return wave(X0, X0 + f * L, (u) => Y - displacement(u, t));
}

// A few motes of dust drifting upward, for depth.
const motes = (() => {
  const r = rng(11);
  return Array.from({ length: 34 }, () => ({
    x: r() * 1920,
    y: r() * 1080,
    s: 1.5 + r() * 3.2,
    v: 8 + r() * 18,
    a: 0.05 + r() * 0.09,
  }));
})();

function pluckHand(ctx, p, index) {
  // Approach from above-right, pinch the middle of the vibrating length, pull, let go, leave.
  const f = p.f;
  const cx = X0 + (f * L) / 2;
  return (t) => {
    const arrive = outCubic(seg(t, p.t - 1.3, p.t - 0.65));
    const pinch =
      smooth(seg(t, p.t - 0.75, p.t - 0.55)) *
      (1 - smooth(seg(t, p.t, p.t + 0.12)));
    const pull = smooth(seg(t, p.t - 0.7, p.t)) * AMP * (t < p.t ? 1 : 0);
    const leave = inOutCubic(seg(t, p.t + 0.2, p.t + 0.95));
    const scale = 128;
    // Rotated half a turn so the fingers point down and the arm comes from above.
    const px = cx + (1 - arrive) * 420 + leave * 380;
    const py = Y - pull - 26 - (1 - arrive) * 420 - leave * 380;
    if (t < p.t - 1.3 || t > p.t + 1.0) return;
    // Place the pinch point (between the index and thumb tips) on the string.
    const pts = pose("open", "pluck", pinch);
    const pinchPoint = [
      (pts[4][0] + pts[8][0]) / 2,
      (pts[4][1] + pts[8][1]) / 2,
    ];
    // Rotate by PI: a point (x, y) in hand units lands at wrist - (x, y) * scale.
    const wrist = [px + pinchPoint[0] * scale, py + pinchPoint[1] * scale];
    drawHand(ctx, pts, {
      x: wrist[0],
      y: wrist[1],
      scale,
      rotate: Math.PI,
      fill: SKIN,
      forearm: true,
      sleeve: SLEEVE,
    });
  };
}

export default {
  bg: PALETTE.night,
  ink: "#f4ead2",
  lineColor: PALETTE.vermilion,
  captionAt: 7.0,
  ghostY: 690,

  line: lineAt,
  lineStyle(t) {
    const p = outCubic(seg(t, 0.1, 1.0));
    return { from: 0.5 - 0.5 * p, to: 0.5 + 0.5 * p, width: 7 };
  },

  back(ctx, t) {
    // Dust.
    for (const m of motes)
      fillCircle(
        ctx,
        m.x,
        (m.y - t * m.v + 2000) % 1080,
        m.s,
        "#cfd8ff",
        m.a * smooth(seg(t, 0, 1.5)),
      );

    // Rings of sound from each pluck: air set moving.
    for (const p of PLUCKS) {
      const age = t - p.t;
      if (age < 0 || age > 2.4) continue;
      const cx = X0 + (p.f * L) / 2;
      for (let k = 0; k < 3; k++) {
        const a = age - k * 0.22;
        if (a < 0) continue;
        const life = a / 2.0;
        if (life > 1) continue;
        ctx.save();
        ctx.strokeStyle = rgba("#cfd8ff", 0.22 * (1 - life));
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(cx, Y, 40 + a * 360, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // The monochord rises into view under the string.
    const rise = outBack(seg(t, local(monochord), local(monochord) + 1.0), 1.2);
    if (rise > 0) {
      ctx.save();
      ctx.translate(0, (1 - rise) * 320);
      ctx.globalAlpha = smooth(
        seg(t, local(monochord), local(monochord) + 0.5),
      );
      paperRect(ctx, 226, 482, 1468, 168, 22, PALETTE.wood);
      paperRect(ctx, 226, 482, 1468, 30, 22, "#a8743f", { shadow: false });
      // Wood grain, a few long strokes along the box.
      for (const [gy, ga, gx0, gx1] of [
        [528, 0.1, 260, 1100],
        [548, 0.07, 700, 1660],
        [592, 0.09, 240, 900],
        [566, 0.06, 1100, 1670],
      ])
        lineSeg(ctx, gx0, gy, gx1, gy + 2, "#3b2616", 2, { opacity: ga });
      for (const x of [690, 960, 1230])
        paperCircle(ctx, x, 570, 28, "#3b2616", { shadow: false });
      // The ruler: ticks where the bridge makes the octave, fifth, and fourth.
      paperRect(ctx, 262, 606, 1396, 30, 6, "#efe6cf", { shadow: false });
      for (const [fraction, label] of [
        [1, "1"],
        [3 / 4, "3/4"],
        [2 / 3, "2/3"],
        [1 / 2, "1/2"],
      ]) {
        const x = X0 + fraction * L;
        lineSeg(ctx, x, 606, x, 626, "#5a3b22", 3);
        text(ctx, label, x, 668, {
          font: `500 17px ${FONT.mono}`,
          color: "#e8dfca",
          align: "center",
          opacity: 0.85,
        });
      }
      // The fixed bridges, then the movable one.
      const f = bridge(t);
      const post = (x, fill) =>
        paper(
          ctx,
          (c) => {
            c.moveTo(x - 20, 482);
            c.lineTo(x - 9, Y - 4);
            c.lineTo(x + 9, Y - 4);
            c.lineTo(x + 20, 482);
            c.closePath();
          },
          fill,
          { shadow: true, dx: 3, dy: 5 },
        );
      post(X0, "#e8dfca");
      post(X1, "#e8dfca");
      if (f < 0.999 || t < BRIDGE_HOME + 0.5) {
        const x = X0 + f * L;
        post(x, PALETTE.brass);
        // The dead length of string beyond the bridge.
        lineSeg(ctx, x, Y, X1, Y, "#e8dfca", 3, { opacity: 0.4 });
      }
      ctx.restore();
    }

    // Overtone stack: each harmonic, drawn as its own wave above the string.
    if (inHarmonics(t)) {
      const modes = overtones(t);
      modes.forEach((m, i) => {
        if (m.level <= 0.001) return;
        const base = 196 + i * 46;
        const line = wave(
          X0,
          X1,
          (u) => base - modeShape(u, m, m.age) * 0.55,
          160,
        );
        ctx.save();
        ctx.globalAlpha = smooth(clamp(m.age / 0.4));
        ctx.strokeStyle = m.color;
        ctx.lineWidth = 3.5;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(line[0], line[1]);
        for (let k = 1; k < line.length / 2; k++)
          ctx.lineTo(line[2 * k], line[2 * k + 1]);
        ctx.stroke();
        ctx.restore();
        text(ctx, `${m.n}×`, X0 - 56, base + 6, {
          font: `600 22px ${FONT.mono}`,
          color: m.color,
          align: "right",
          opacity: smooth(clamp(m.age / 0.4)),
        });
      });
      const head = smooth(seg(t, HARMONICS[0].t - 0.2, HARMONICS[0].t + 0.6));
      text(ctx, "ONE STRING, MANY WAVES", X1, 140, {
        font: `500 17px ${FONT.mono}`,
        color: "#f4ead2",
        align: "right",
        tracking: 4,
        opacity: 0.8 * head * (1 - smooth(seg(t, 17.5, 18.8))),
      });
    }
  },

  front(ctx, t) {
    // Hands that pluck.
    PLUCKS.forEach((p, i) => pluckHand(ctx, p, i)(t));

    // The title card over the opening seconds.
    const [a, b] = title.map(local);
    const inT = outCubic(seg(t, a, a + 1.1));
    const outT = smooth(seg(t, b - 0.5, b + 0.3));
    if (inT > 0 && outT < 1) {
      const alpha = inT * (1 - outT);
      const words = "Between Hand and Sound";
      ctx.save();
      ctx.globalAlpha = alpha;
      text(ctx, words, 960, 288 + (1 - inT) * 26 - outT * 20, {
        font: `600 120px ${FONT.serif}`,
        color: "#f4ead2",
        align: "center",
      });
      text(
        ctx,
        "A short history of the machines in between.",
        960,
        352 + (1 - inT) * 26 - outT * 20,
        {
          font: `italic 400 38px ${FONT.serif}`,
          color: "#f4ead2",
          align: "center",
          opacity: 0.8,
        },
      );
      ctx.restore();
    }

    // The ratio, big, with its note.
    for (const s of SLIDES) {
      const end = s.slide + (s === SLIDES.at(-1) ? 2.2 : 2.4);
      const age = t - s.pluck;
      if (age < 0 || t > end) continue;
      const pop = outBack(seg(age, 0, 0.5), 1.8);
      const gone = smooth(seg(t, end - 0.5, end));
      const [note, hz] = NOTES[s.name];
      ctx.save();
      ctx.globalAlpha = (1 - gone) * smooth(seg(age, 0, 0.2));
      ctx.translate(1330, 300);
      ctx.scale(0.8 + 0.2 * pop, 0.8 + 0.2 * pop);
      text(ctx, `${s.ratio[0]} : ${s.ratio[1]}`, 0, 0, {
        font: `italic 600 150px ${FONT.serif}`,
        color: "#f4ead2",
        align: "center",
      });
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = (1 - gone) * smooth(seg(age, 0.15, 0.5));
      text(ctx, `${s.name.toUpperCase()}  ·  ${note}  ·  ${hz}`, 1330, 372, {
        font: `500 24px ${FONT.mono}`,
        color: PALETTE.mustard,
        align: "center",
        tracking: 4,
      });
      ctx.restore();
    }
  },
};
