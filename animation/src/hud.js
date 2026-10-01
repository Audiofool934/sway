// The film's recurring typography: a giant ghost of each chapter's verb behind the art, a
// small chapter label, the caption (date, headline, sentence), and a ribbon along the
// bottom that lists all eleven verbs and fills with the Line as the film advances.

import { clamp, outCubic, seg, smooth, window } from "./core/ease.js";
import { FONT, measure, rgba, text, wrap } from "./core/draw.js";
import { chapters, DURATION, H, W } from "./timeline.js";

const MARGIN = 100;
const VERBS = chapters.filter((c) => c.verb).map((c) => c.verb);

/** A ghost of the chapter's verb, huge and faint, rising into place letter by letter. */
export function drawGhost(ctx, chapter, scene, t) {
  if (!chapter.verb || scene.ghost === false) return;
  const word = chapter.verb.toUpperCase();
  const base = `600 100px ${FONT.serif}`;
  const size = Math.min(430, (1560 / measure(ctx, word, base, 0)) * 100);
  const font = `600 ${size}px ${FONT.serif}`;
  const total = measure(ctx, word, font, 0);
  let x = (W - total) / 2;
  const y = scene.ghostY ?? 640;
  [...word].forEach((letter, i) => {
    const p = outCubic(seg(t, 0.1 + i * 0.07, 0.9 + i * 0.07));
    const width = measure(ctx, letter, font, 0);
    text(ctx, letter, x, y + (1 - p) * 70, {
      font,
      color: scene.ink,
      opacity: (scene.ghostAlpha ?? 0.07) * p,
    });
    x += width;
  });
}

/** The chapter label and caption for `chapter`, at local time t. */
export function drawCaption(ctx, chapter, scene, t, alpha = 1) {
  if (!chapter.verb || alpha <= 0) return;
  const ink = scene.ink;
  const accent = scene.lineColor;
  const out =
    1 - smooth(seg(t, chapter.duration - 0.55, chapter.duration - 0.05));
  const a = alpha * out;

  // Chapter label, top left.
  const labelAlpha = a * smooth(seg(t, 0.3, 0.9));
  const number = String(chapter.index + 1).padStart(2, "0");
  text(ctx, number, MARGIN, 96, {
    font: `600 20px ${FONT.mono}`,
    color: accent,
    tracking: 2,
    opacity: labelAlpha,
  });
  text(ctx, chapter.verb.toUpperCase(), MARGIN + 44, 96, {
    font: `500 20px ${FONT.mono}`,
    color: ink,
    tracking: 4,
    opacity: labelAlpha,
  });

  // Caption, bottom left, rising in three beats: date, headline, sentence.
  const at = scene.captionAt ?? 2.1;
  const rise = (delay) => {
    const p = outCubic(seg(t, at + delay, at + delay + 0.7));
    return { p, dy: (1 - p) * 16 };
  };
  const year = rise(0);
  const head = rise(0.3);
  const body = rise(0.6);
  const bodyFont = `400 26px ${FONT.sans}`;
  const lines = wrap(ctx, chapter.body, 960, bodyFont, 0);
  const bottom = 982;
  const lineHeight = 37;
  const bodyTop = bottom - (lines.length - 1) * lineHeight;
  lines.forEach((line, i) =>
    text(ctx, line, MARGIN, bodyTop + i * lineHeight + body.dy, {
      font: bodyFont,
      color: ink,
      opacity: a * body.p * 0.9,
    }),
  );
  text(ctx, chapter.head, MARGIN, bodyTop - 50 + head.dy, {
    font: `600 56px ${FONT.serif}`,
    color: ink,
    opacity: a * head.p,
  });
  text(ctx, chapter.year.toUpperCase(), MARGIN, bodyTop - 118 + year.dy, {
    font: `500 19px ${FONT.mono}`,
    color: accent,
    tracking: 2.5,
    opacity: a * year.p,
  });
}

/**
 * The ribbon of verbs along the bottom. `progress` runs from 0 to the number of verbs
 * (a chapter index plus how far through it we are); the Line fills as it advances.
 */
export function drawRibbon(ctx, progress, { ink, accent, opacity = 1 }) {
  const y = 1042;
  const x0 = MARGIN;
  const x1 = W - MARGIN;
  const step = (x1 - x0) / (VERBS.length - 1);
  const filled = clamp(progress / (VERBS.length - 1), 0, 1);
  ctx.save();
  ctx.globalAlpha *= opacity;
  ctx.lineCap = "round";
  ctx.strokeStyle = rgba(ink, 0.22);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, y - 22);
  ctx.lineTo(x1, y - 22);
  ctx.stroke();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x0, y - 22);
  ctx.lineTo(x0 + (x1 - x0) * filled, y - 22);
  ctx.stroke();
  VERBS.forEach((verb, i) => {
    const x = x0 + i * step;
    const near = clamp(1 - Math.abs(progress - i), 0, 1);
    const passed = progress >= i - 0.001;
    ctx.fillStyle = passed ? accent : rgba(ink, 0.35);
    ctx.beginPath();
    ctx.arc(x, y - 22, 4 + 5 * smooth(near), 0, Math.PI * 2);
    ctx.fill();
    text(ctx, verb.toUpperCase(), x, y + 2, {
      font: `${near > 0.5 ? 600 : 500} 14px ${FONT.mono}`,
      color: ink,
      align: i === 0 ? "left" : i === VERBS.length - 1 ? "right" : "center",
      tracking: 2,
      opacity: 0.35 + 0.65 * smooth(near),
    });
  });
  ctx.restore();
}

/** The small wordmark, top right. */
export function drawMark(ctx, ink, opacity = 1) {
  text(ctx, "BETWEEN HAND AND SOUND", W - MARGIN, 96, {
    font: `500 14px ${FONT.mono}`,
    color: ink,
    align: "right",
    tracking: 3,
    opacity: 0.45 * opacity,
  });
}

export { DURATION, H, window };
