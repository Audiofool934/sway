// Small reusable props shared by several scenes.

import {
  PALETTE,
  circlePath,
  ink,
  lineSeg,
  paper,
  paperCircle,
  rgba,
} from "./draw.js";

/** A line with an arrowhead at its end. */
export function arrow(
  ctx,
  x1,
  y1,
  x2,
  y2,
  color,
  { width = 2.5, head = 11, opacity = 1 } = {},
) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  lineSeg(
    ctx,
    x1,
    y1,
    x2 - Math.cos(a) * head * 0.6,
    y2 - Math.sin(a) * head * 0.6,
    color,
    width,
    { opacity },
  );
  ctx.save();
  ctx.globalAlpha *= opacity;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - Math.cos(a - 0.45) * head, y2 - Math.sin(a - 0.45) * head);
  ctx.lineTo(x2 - Math.cos(a + 0.45) * head, y2 - Math.sin(a + 0.45) * head);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** A tape reel: a flanged disc with spokes, turned by `turn` radians. */
export function reel(
  ctx,
  x,
  y,
  r,
  turn,
  {
    fill = "#cfd6da",
    hole = "#2a2233",
    tape = "#2a1d17",
    tapeR = r * 0.78,
  } = {},
) {
  paperCircle(ctx, x, y, r, tape === null ? fill : "#3a2a24", { dx: 5, dy: 8 });
  if (tape !== null) paperCircle(ctx, x, y, tapeR, tape, { shadow: false });
  paperCircle(ctx, x, y, r * 0.42, fill, { shadow: false });
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(turn);
  for (let k = 0; k < 3; k++) {
    ctx.save();
    ctx.rotate((k * 2 * Math.PI) / 3);
    ctx.fillStyle = hole;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.24, r * 0.1, r * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  paperCircle(ctx, x, y, r * 0.07, "#8c949a", { shadow: false });
}

/** A knob with a pointer, `angle` in radians (0 points up). */
export function knob(
  ctx,
  x,
  y,
  r,
  angle,
  { fill = "#2a2d36", cap = "#f4ead2", ring = null } = {},
) {
  if (ring) {
    ctx.save();
    ctx.strokeStyle = rgba(ring, 0.5);
    ctx.lineWidth = 2;
    for (let k = 0; k <= 10; k++) {
      const a = -Math.PI * 0.75 + (k / 10) * Math.PI * 1.5 - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * (r + 8), y + Math.sin(a) * (r + 8));
      ctx.lineTo(x + Math.cos(a) * (r + 15), y + Math.sin(a) * (r + 15));
      ctx.stroke();
    }
    ctx.restore();
  }
  paperCircle(ctx, x, y, r, fill, { dx: 3, dy: 5 });
  paperCircle(ctx, x, y, r * 0.78, "#3b3f4b", { shadow: false });
  const a = angle - Math.PI / 2;
  lineSeg(
    ctx,
    x + Math.cos(a) * r * 0.2,
    y + Math.sin(a) * r * 0.2,
    x + Math.cos(a) * r * 0.72,
    y + Math.sin(a) * r * 0.72,
    cap,
    4,
  );
}

/** A hanging cable between two points, sagging by `sag` pixels and swaying slightly. */
export function cable(
  ctx,
  x1,
  y1,
  x2,
  y2,
  color,
  { sag = 90, width = 9, sway = 0, opacity = 1 } = {},
) {
  const mx = (x1 + x2) / 2 + sway;
  const my = (y1 + y2) / 2 + sag;
  ink(
    ctx,
    (c) => {
      c.moveTo(x1, y1);
      c.quadraticCurveTo(mx, my + sag * 0.3, x2, y2);
    },
    "rgba(0,0,0,0.28)",
    width + 2,
    { opacity },
  );
  ctx.save();
  ctx.translate(-2, -3);
  ink(
    ctx,
    (c) => {
      c.moveTo(x1, y1);
      c.quadraticCurveTo(mx, my + sag * 0.3, x2, y2);
    },
    color,
    width,
    { opacity },
  );
  ctx.restore();
}

/** A round jack socket. */
export function jack(ctx, x, y, r = 12, fill = "#0f1014") {
  paperCircle(ctx, x, y, r + 5, "#8c949a", { dx: 2, dy: 3 });
  paperCircle(ctx, x, y, r, fill, { shadow: false });
  paperCircle(ctx, x, y, r * 0.38, "#3a3d47", { shadow: false });
}

/** A check mark. */
export function check(ctx, x, y, size, color, progress = 1, width = 6) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const pts = [
    [x - size * 0.5, y],
    [x - size * 0.12, y + size * 0.42],
    [x + size * 0.55, y - size * 0.4],
  ];
  ctx.beginPath();
  ctx.moveTo(...pts[0]);
  const first = Math.min(1, progress * 2);
  ctx.lineTo(
    pts[0][0] + (pts[1][0] - pts[0][0]) * first,
    pts[0][1] + (pts[1][1] - pts[0][1]) * first,
  );
  if (progress > 0.5) {
    const second = (progress - 0.5) * 2;
    ctx.lineTo(
      pts[1][0] + (pts[2][0] - pts[1][0]) * second,
      pts[1][1] + (pts[2][1] - pts[1][1]) * second,
    );
  }
  ctx.stroke();
  ctx.restore();
}

export { PALETTE, circlePath, paper };
