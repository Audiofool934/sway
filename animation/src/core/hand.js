// A stylized flat hand, used in three scenes: the medieval "Guidonian" hand, the theremin
// player's hands, and the performer in the Sway finale. A hand is 21 landmarks (the same
// indexing MediaPipe uses, and which Sway tracks): wrist, then thumb, index, middle, ring,
// and pinky joints from base to tip. Poses are interpolated landmark by landmark, and the
// silhouette is a single filled union of capsules so it casts one clean paper shadow.

import { lerp } from "./ease.js";
import { capsulePath, circlePath, ink, paper, rgba } from "./draw.js";

// Right hand, palm toward the viewer, fingers up, thumb on the left (as in Sway's mirrored
// camera view). Units: one palm length is about 1.1; the wrist is the origin; y is down.
const OPEN = [
  [0, 0],
  [-0.38, -0.22],
  [-0.62, -0.5],
  [-0.8, -0.74],
  [-0.93, -0.98],
  [-0.36, -1.02],
  [-0.42, -1.46],
  [-0.45, -1.74],
  [-0.47, -1.97],
  [-0.11, -1.08],
  [-0.11, -1.58],
  [-0.11, -1.88],
  [-0.11, -2.12],
  [0.14, -1.04],
  [0.18, -1.5],
  [0.2, -1.78],
  [0.21, -2.0],
  [0.37, -0.93],
  [0.46, -1.3],
  [0.5, -1.52],
  [0.53, -1.71],
];

// Fingers folded over the palm; the thumb crosses in front.
const FIST = [
  [0, 0],
  [-0.38, -0.22],
  [-0.52, -0.46],
  [-0.34, -0.66],
  [-0.12, -0.7],
  [-0.36, -1.02],
  [-0.4, -1.2],
  [-0.37, -0.98],
  [-0.33, -0.78],
  [-0.11, -1.08],
  [-0.11, -1.27],
  [-0.1, -1.04],
  [-0.09, -0.82],
  [0.14, -1.04],
  [0.17, -1.22],
  [0.17, -1.0],
  [0.17, -0.8],
  [0.37, -0.93],
  [0.42, -1.08],
  [0.4, -0.9],
  [0.37, -0.74],
];

// Thumb and index tips together, a ring between them; the other fingers relaxed.
const PINCH = [
  [0, 0],
  [-0.38, -0.22],
  [-0.66, -0.46],
  [-0.88, -0.74],
  [-0.82, -1.1],
  [-0.36, -1.02],
  [-0.44, -1.42],
  [-0.66, -1.5],
  [-0.82, -1.26],
  [-0.11, -1.08],
  [-0.1, -1.56],
  [-0.1, -1.82],
  [-0.1, -2.0],
  [0.14, -1.04],
  [0.18, -1.48],
  [0.2, -1.72],
  [0.2, -1.88],
  [0.37, -0.93],
  [0.46, -1.28],
  [0.5, -1.46],
  [0.52, -1.6],
];

// Index finger extended, the rest folded: for pointing.
const POINT = [
  [0, 0],
  [-0.38, -0.22],
  [-0.52, -0.46],
  [-0.34, -0.66],
  [-0.14, -0.74],
  [-0.36, -1.02],
  [-0.42, -1.46],
  [-0.45, -1.74],
  [-0.47, -1.97],
  [-0.11, -1.08],
  [-0.11, -1.27],
  [-0.1, -1.04],
  [-0.09, -0.82],
  [0.14, -1.04],
  [0.17, -1.22],
  [0.17, -1.0],
  [0.17, -0.8],
  [0.37, -0.93],
  [0.42, -1.08],
  [0.4, -0.9],
  [0.37, -0.74],
];

// A grip on a string: the pinch of thumb and index, the other three fingers curled in.
const PLUCK = PINCH.map((point, i) => (i <= 8 ? point : FIST[i]));

export const POSES = {
  open: OPEN,
  fist: FIST,
  pinch: PINCH,
  point: POINT,
  pluck: PLUCK,
};

/** Blend two poses (names or landmark arrays). */
export function pose(a, b = a, u = 0) {
  const A = typeof a === "string" ? POSES[a] : a;
  const B = typeof b === "string" ? POSES[b] : b;
  return A.map(([x, y], i) => [lerp(x, B[i][0], u), lerp(y, B[i][1], u)]);
}

const FINGERS = [
  { ids: [1, 2, 3, 4], width: [0.25, 0.23, 0.2] },
  { ids: [5, 6, 7, 8], width: [0.21, 0.19, 0.17] },
  { ids: [9, 10, 11, 12], width: [0.21, 0.19, 0.17] },
  { ids: [13, 14, 15, 16], width: [0.2, 0.18, 0.16] },
  { ids: [17, 18, 19, 20], width: [0.18, 0.16, 0.14] },
];
const BONES = [
  ...FINGERS.flatMap(({ ids }) => ids.slice(1).map((id, i) => [ids[i], id])),
  [0, 1],
  [0, 5],
  [5, 9],
  [9, 13],
  [13, 17],
  [17, 0],
];

/**
 * Transform landmarks into screen space: `x`, `y` place the wrist, `scale` is pixels per
 * unit, `rotate` turns the hand (radians), `mirror` makes a left hand.
 */
export function place(landmarks, { x, y, scale, rotate = 0, mirror = false }) {
  const cos = Math.cos(rotate);
  const sin = Math.sin(rotate);
  return landmarks.map(([px, py]) => {
    const mx = (mirror ? -px : px) * scale;
    const my = py * scale;
    return [x + mx * cos - my * sin, y + mx * sin + my * cos];
  });
}

/** Add a polygon with clockwise winding (as the capsules have), whatever order it came in. */
function polygon(ctx, pts) {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    area += x1 * y2 - x2 * y1;
  }
  const ordered = area < 0 ? [...pts].reverse() : pts;
  ctx.moveTo(ordered[0][0], ordered[0][1]);
  for (const [x, y] of ordered.slice(1)) ctx.lineTo(x, y);
  ctx.closePath();
}

/** The forearm as four screen points: wrist edge, then the far end (`length` units down). */
function forearmPoints(points, scale, length = 1.9) {
  const [wx, wy] = points[0];
  // The hand's own axis: from the wrist toward the middle knuckle.
  const [mx, my] = points[9];
  const d = Math.hypot(mx - wx, my - wy) || 1;
  const ax = (mx - wx) / d;
  const ay = (my - wy) / d;
  const nx = -ay;
  const ny = ax;
  const at = (along, across) => [
    wx - ax * along * scale + nx * across * scale,
    wy - ay * along * scale + ny * across * scale,
  ];
  return [at(-0.05, -0.3), at(-0.05, 0.3), at(length, 0.38), at(length, -0.38)];
}

/** The silhouette as a path function for paper(): palm, finger capsules, and fingertips. */
export function silhouette(points, scale, { forearm = false } = {}) {
  const length = typeof forearm === "number" ? forearm : 1.9;
  return (ctx) => {
    polygon(
      ctx,
      [0, 1, 5, 9, 13, 17].map((i) => points[i]),
    );
    for (const [a, b] of [
      [0, 1],
      [1, 5],
      [5, 9],
      [9, 13],
      [13, 17],
      [17, 0],
    ])
      capsulePath(
        ctx,
        points[a][0],
        points[a][1],
        points[b][0],
        points[b][1],
        scale * 0.11,
      );
    for (const { ids, width } of FINGERS)
      for (let k = 0; k < 3; k++) {
        const [x1, y1] = points[ids[k]];
        const [x2, y2] = points[ids[k + 1]];
        if (Math.hypot(x2 - x1, y2 - y1) < 1)
          circlePath(ctx, x1, y1, scale * width[k] * 0.5);
        else capsulePath(ctx, x1, y1, x2, y2, scale * width[k] * 0.5);
      }
    if (forearm) polygon(ctx, forearmPoints(points, scale, length));
    else circlePath(ctx, points[0][0], points[0][1], scale * 0.24);
  };
}

/**
 * Draw a paper-cut hand. With `forearm`, an arm runs off below the wrist; `sleeve` colors
 * its far part like a cuff.
 */
export function drawHand(
  ctx,
  landmarks,
  {
    x,
    y,
    scale = 200,
    rotate = 0,
    mirror = false,
    fill = "#f1c9a5",
    shadow = true,
    opacity = 1,
    crease = null,
    forearm = false,
    sleeve = null,
    outline = null,
    outlineWidth = 8,
  },
) {
  const points = place(landmarks, { x, y, scale, rotate, mirror });
  if (outline) {
    // An engraved outline: stroke the silhouette first; the fill covers the inner half.
    ctx.save();
    ctx.globalAlpha *= opacity;
    ctx.strokeStyle = outline;
    ctx.lineWidth = outlineWidth;
    ctx.lineJoin = "round";
    ctx.beginPath();
    silhouette(points, scale, { forearm })(ctx);
    ctx.stroke();
    ctx.restore();
  }
  paper(ctx, silhouette(points, scale, { forearm }), fill, { shadow, opacity });
  if (forearm && sleeve) {
    const arm = forearmPoints(
      points,
      scale,
      typeof forearm === "number" ? forearm : 1.9,
    );
    // The sleeve: the far 60% of the forearm, slightly flared.
    const lerpPoint = (a, b, u) => [
      a[0] + (b[0] - a[0]) * u,
      a[1] + (b[1] - a[1]) * u,
    ];
    const near = [
      lerpPoint(arm[1], arm[2], 0.42),
      lerpPoint(arm[0], arm[3], 0.42),
    ];
    paper(ctx, (c) => polygon(c, [near[0], arm[2], arm[3], near[1]]), sleeve, {
      shadow: false,
      opacity,
    });
  }
  if (crease) {
    for (const { ids } of FINGERS.slice(1))
      ink(
        ctx,
        (c) => {
          c.moveTo(points[ids[1]][0], points[ids[1]][1]);
          c.lineTo(points[ids[3]][0], points[ids[3]][1]);
        },
        crease,
        scale * 0.012,
        { opacity: 0.5 * opacity },
      );
  }
  return points;
}

/** The thin bones and small joint dots Sway's tracker overlay shows. */
export function drawSkeleton(
  ctx,
  points,
  {
    color = "#ffb547",
    alpha = 0.7,
    width = 2,
    dots = true,
    markers = [0, 4, 8, 12, 16, 20],
  } = {},
) {
  ink(
    ctx,
    (c) => {
      for (const [a, b] of BONES) {
        c.moveTo(points[a][0], points[a][1]);
        c.lineTo(points[b][0], points[b][1]);
      }
    },
    rgba(color, alpha),
    width,
  );
  if (dots) {
    ctx.save();
    ctx.fillStyle = rgba(color, Math.min(1, alpha + 0.2));
    for (const id of markers) {
      ctx.beginPath();
      ctx.arc(points[id][0], points[id][1], width * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

export const JOINTS = {
  wrist: 0,
  thumbTip: 4,
  indexTip: 8,
  middleTip: 12,
  ringTip: 16,
  pinkyTip: 20,
};
