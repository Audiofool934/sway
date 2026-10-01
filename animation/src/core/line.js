// The Line: one polyline that every chapter reshapes. It is a string, a staff line, a
// groove, a pitch contour, a staircase of voltage, a row of samples, a timeline. Because
// each scene describes its Line with the same number of points, the compositor can morph
// one scene's Line into the next as the chapters change.

import { lerp } from "./ease.js";

export const N = 360;

/** A flat [x0, y0, x1, y1, ...] polyline resampled to `n` points evenly by arc length. */
export function resample(points, n = N) {
  const count = points.length / 2;
  const cumulative = new Float64Array(count);
  for (let i = 1; i < count; i++)
    cumulative[i] =
      cumulative[i - 1] +
      Math.hypot(
        points[2 * i] - points[2 * i - 2],
        points[2 * i + 1] - points[2 * i - 1],
      );
  const total = cumulative[count - 1] || 1;
  const out = new Float32Array(2 * n);
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = (k / (n - 1)) * total;
    while (j < count - 2 && cumulative[j + 1] < target) j++;
    const span = cumulative[j + 1] - cumulative[j] || 1;
    const u = Math.min(1, Math.max(0, (target - cumulative[j]) / span));
    out[2 * k] = lerp(points[2 * j], points[2 * j + 2], u);
    out[2 * k + 1] = lerp(points[2 * j + 1], points[2 * j + 3], u);
  }
  return out;
}

/** A straight Line from (x0, y0) to (x1, y1). */
export function straight(x0, y0, x1, y1, n = N) {
  const out = new Float32Array(2 * n);
  for (let k = 0; k < n; k++) {
    const u = k / (n - 1);
    out[2 * k] = lerp(x0, x1, u);
    out[2 * k + 1] = lerp(y0, y1, u);
  }
  return out;
}

/** A Line from a function of u in [0, 1] that returns [x, y]. */
export function fromFunction(fn, n = N) {
  const out = new Float32Array(2 * n);
  for (let k = 0; k < n; k++) {
    const [x, y] = fn(k / (n - 1));
    out[2 * k] = x;
    out[2 * k + 1] = y;
  }
  return out;
}

/** A Line along x from x0 to x1 whose height is `fn(u, x)`, for waves and strings. */
export function wave(x0, x1, fn, n = N) {
  const out = new Float32Array(2 * n);
  for (let k = 0; k < n; k++) {
    const u = k / (n - 1);
    const x = lerp(x0, x1, u);
    out[2 * k] = x;
    out[2 * k + 1] = fn(u, x);
  }
  return out;
}

/** Blend two Lines point by point. */
export function morph(a, b, u) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] + (b[i] - a[i]) * u;
  return out;
}

/** The point a fraction `u` of the way along a Line (by index). */
export function pointAt(line, u) {
  const n = line.length / 2;
  const f = Math.min(n - 1, Math.max(0, u * (n - 1)));
  const i = Math.min(n - 2, Math.floor(f));
  const k = f - i;
  return [
    lerp(line[2 * i], line[2 * i + 2], k),
    lerp(line[2 * i + 1], line[2 * i + 3], k),
  ];
}

/**
 * Draw the Line. `from` and `to` (0 to 1) draw only part of it, which is how it draws
 * itself on. A hard paper shadow sits beneath it by default.
 */
export function drawLine(
  ctx,
  line,
  {
    color = "#ff5b3a",
    width = 8,
    from = 0,
    to = 1,
    shadow = true,
    opacity = 1,
    cap = "round",
  } = {},
) {
  if (!line || to <= from) return;
  const n = line.length / 2;
  const a = Math.max(0, Math.floor(from * (n - 1)));
  const b = Math.min(n - 1, Math.ceil(to * (n - 1)));
  if (b <= a) return;
  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(line[2 * a], line[2 * a + 1]);
    for (let i = a + 1; i <= b; i++) ctx.lineTo(line[2 * i], line[2 * i + 1]);
  };
  ctx.save();
  ctx.globalAlpha *= opacity;
  ctx.lineCap = cap;
  ctx.lineJoin = "round";
  if (shadow) {
    ctx.save();
    ctx.translate(3, 6);
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = width;
    trace();
    ctx.stroke();
    ctx.restore();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  trace();
  ctx.stroke();
  ctx.restore();
}
