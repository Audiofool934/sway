// Drawing helpers for the film's cut-paper look: flat shapes, hard offset shadows,
// generous round corners, and a little grain. Colors are hex strings.

import { MONO, SANS, SERIF } from "./fonts.js";

export const PALETTE = {
  cream: "#f6eedc",
  parchment: "#ecdcb8",
  sand: "#e3cfa5",
  ink: "#1d1b2e",
  night: "#171f3d",
  indigo: "#3a4a8c",
  sky: "#9cc5e8",
  teal: "#2a9d8f",
  mint: "#bfe3d0",
  sage: "#8ab17d",
  mustard: "#f2b544",
  amber: "#ffb547",
  vermilion: "#ff5b3a",
  blush: "#f4b8a8",
  plum: "#6a3f7a",
  wood: "#8a5a35",
  brass: "#cf9d3d",
  rust: "#a24a2e",
  charcoal: "#24252f",
  white: "#ffffff",
};

export const hex = (color) => {
  const h = color.replace("#", "");
  const n = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
};
export const rgba = (color, a = 1) => {
  const [r, g, b] = hex(color);
  return `rgba(${r},${g},${b},${a})`;
};
/** Blend two hex colors (t = 0 gives a, t = 1 gives b). */
export const mix = (a, b, t) => {
  const [r1, g1, b1] = hex(a);
  const [r2, g2, b2] = hex(b);
  const c = (x, y) => Math.round(x + (y - x) * t);
  return `rgb(${c(r1, r2)},${c(g1, g2)},${c(b1, b2)})`;
};
export const lighten = (color, t) => mix(color, "#ffffff", t);
export const darken = (color, t) => mix(color, "#000000", t);

// ------------------------------------------------------------------ paths

export function rrectPath(ctx, x, y, w, h, r = 12) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function circlePath(ctx, x, y, r) {
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.closePath();
}

/** A capsule between two points with radius r. */
export function capsulePath(ctx, x1, y1, x2, y2, r) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  ctx.moveTo(
    x1 + Math.cos(a + Math.PI / 2) * r,
    y1 + Math.sin(a + Math.PI / 2) * r,
  );
  ctx.arc(x1, y1, r, a + Math.PI / 2, a + (3 * Math.PI) / 2);
  ctx.arc(x2, y2, r, a - Math.PI / 2, a + Math.PI / 2);
  ctx.closePath();
}

// ------------------------------------------------------------------ paper

export const SHADOW = { dx: 5, dy: 8, alpha: 0.26 };

/**
 * Fill a path as a sheet of paper: a hard offset shadow beneath, then the color.
 * `path(ctx)` adds the shape's subpaths; it must not call beginPath or fill.
 */
export function paper(
  ctx,
  path,
  fill,
  {
    shadow = true,
    dx = SHADOW.dx,
    dy = SHADOW.dy,
    alpha = SHADOW.alpha,
    stroke = null,
    lineWidth = 2,
    opacity = 1,
  } = {},
) {
  ctx.save();
  ctx.globalAlpha *= opacity;
  if (shadow) {
    ctx.save();
    ctx.translate(dx, dy);
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    ctx.beginPath();
    path(ctx);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = fill;
  ctx.beginPath();
  path(ctx);
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
  ctx.restore();
}

export const paperRect = (ctx, x, y, w, h, r, fill, opts) =>
  paper(ctx, (c) => rrectPath(c, x, y, w, h, r), fill, opts);
export const paperCircle = (ctx, x, y, r, fill, opts) =>
  paper(ctx, (c) => circlePath(c, x, y, r), fill, opts);

/** Stroke a path with round caps; `path(ctx)` adds subpaths. */
export function ink(
  ctx,
  path,
  color,
  width = 3,
  { cap = "round", join = "round", dash = null, opacity = 1 } = {},
) {
  ctx.save();
  ctx.globalAlpha *= opacity;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = cap;
  ctx.lineJoin = join;
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  path(ctx);
  ctx.stroke();
  ctx.restore();
}

export function lineSeg(ctx, x1, y1, x2, y2, color, width = 3, opts) {
  ink(
    ctx,
    (c) => {
      c.moveTo(x1, y1);
      c.lineTo(x2, y2);
    },
    color,
    width,
    opts,
  );
}

export function fillCircle(ctx, x, y, r, color, opacity = 1) {
  ctx.save();
  ctx.globalAlpha *= opacity;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ------------------------------------------------------------------ text

export const FONT = { serif: SERIF, sans: SANS, mono: MONO };

/**
 * Draw text. `font` is a CSS font shorthand; `align` and `baseline` are canvas values;
 * `tracking` adds letter spacing in px.
 */
export function text(
  ctx,
  string,
  x,
  y,
  {
    font = `400 24px ${SANS}`,
    color = "#fff",
    align = "left",
    baseline = "alphabetic",
    tracking = 0,
    opacity = 1,
    stroke = null,
    strokeWidth = 0,
  } = {},
) {
  ctx.save();
  ctx.globalAlpha *= opacity;
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.letterSpacing = `${tracking}px`;
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeWidth;
    ctx.lineJoin = "round";
    ctx.strokeText(string, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(string, x, y);
  ctx.restore();
}

export function measure(ctx, string, font, tracking = 0) {
  ctx.save();
  ctx.font = font;
  ctx.letterSpacing = `${tracking}px`;
  const width = ctx.measureText(string).width;
  ctx.restore();
  return width;
}

/** Break a paragraph into lines no wider than `maxWidth`. */
export function wrap(ctx, string, maxWidth, font, tracking = 0) {
  const words = string.split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (line && measure(ctx, test, font, tracking) > maxWidth) {
      lines.push(line);
      line = word;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

// ------------------------------------------------------------------ texture

let grainTile = null;
/** A tile of fine neutral noise, made once from a fixed seed. */
function grain() {
  if (grainTile) return grainTile;
  const size = 512;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const image = g.createImageData(size, size);
  let seed = 12345;
  for (let i = 0; i < image.data.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const v = 118 + ((seed >>> 24) % 20);
    image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
    image.data[i + 3] = 255;
  }
  g.putImageData(image, 0, 0);
  grainTile = c.getContext("2d").createPattern(c, "repeat");
  return grainTile;
}

/** Overlay a subtle paper grain and a soft vignette across the whole frame. */
export function finish(ctx, W, H, { grainAmount = 0.1, vignette = 0.22 } = {}) {
  ctx.save();
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = grainAmount;
  ctx.fillStyle = grain();
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  if (vignette > 0) {
    const g = ctx.createRadialGradient(
      W / 2,
      H / 2,
      H * 0.45,
      W / 2,
      H / 2,
      H * 1.0,
    );
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${vignette})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
}
