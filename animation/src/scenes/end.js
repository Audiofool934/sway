// The end card. The final chord rings under a single amber line (the string from the first
// scene, plucked once more), the eleven verbs light up in order, and the last one is yours.

import { FONT, text } from "../core/draw.js";
import { outCubic, seg, smooth } from "../core/ease.js";
import { wave } from "../core/line.js";
import { chapters } from "../timeline.js";

const AMBER = "#ffb547";
const CREAM = "#f4f1ea";
const VERBS = chapters.filter((c) => c.verb).map((c) => c.verb);

export default {
  bg: "#07090b",
  ink: CREAM,
  lineColor: AMBER,
  ghost: false,

  // A string, plucked by the last chord and left to settle.
  line(t) {
    const decay = Math.exp(-Math.max(0, t) / 2.4);
    return wave(
      360,
      1560,
      (u) =>
        548 -
        46 * decay * Math.sin(Math.PI * u) * Math.cos(2 * Math.PI * 2.2 * t) -
        18 *
          decay *
          Math.sin(2 * Math.PI * u) *
          Math.cos(2 * Math.PI * 4.4 * t),
    );
  },
  lineStyle: (t) => ({
    width: 7,
    shadow: false,
    opacity: 1 - smooth(seg(t, 8.4, 9.4)),
  }),

  back(ctx, t) {
    const fadeOut = 1 - smooth(seg(t, 8.2, 9.5));
    const a = (s, e) => smooth(seg(t, s, e)) * fadeOut;
    text(ctx, "Between Hand and Sound", 960, 420, {
      font: `600 108px ${FONT.serif}`,
      color: CREAM,
      align: "center",
      opacity: a(0.8, 2.0),
    });
    // The verbs, lit one by one; the last is the viewer's.
    const gap = 168;
    const x0 = 960 - ((VERBS.length - 1) * gap) / 2;
    VERBS.forEach((verb, i) => {
      const lit = outCubic(seg(t, 1.6 + i * 0.28, 2.1 + i * 0.28));
      const last = i === VERBS.length - 1;
      text(ctx, verb.toUpperCase(), x0 + i * gap, 652, {
        font: `${last ? 700 : 500} ${last ? 20 : 15}px ${FONT.mono}`,
        color: last ? AMBER : CREAM,
        align: "center",
        tracking: 3,
        opacity: (0.25 + 0.55 * lit + (last ? 0.2 * lit : 0)) * fadeOut,
      });
    });
    text(ctx, "Sway: an instrument you play with your hands.", 960, 770, {
      font: `italic 400 34px ${FONT.serif}`,
      color: CREAM,
      align: "center",
      opacity: a(5.2, 6.4) * 0.9,
    });
    text(
      ctx,
      "Picture and music made from code. The last chapter is played by Sway’s own band and synthesizer.",
      960,
      840,
      {
        font: `400 20px ${FONT.sans}`,
        color: CREAM,
        align: "center",
        opacity: a(6.2, 7.4) * 0.6,
      },
    );
  },
};
