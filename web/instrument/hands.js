// Tracker landmarks to stable, smoothed hand features in the mirrored view.
// Tasks HandLandmarker labels unmirrored camera frames by anatomical side.
// Mirror positions to match the preview, but keep the handedness labels unchanged.

const WRIST = 0,
  THUMB_TIP = 4,
  INDEX_TIP = 8,
  MIDDLE_MCP = 9;
const FINGERS = [
  [5, 8],
  [9, 12],
  [13, 16],
  [17, 20],
];
const PALM = [0, 5, 9, 13, 17];
// Palm bones whose lengths, on screen and in metres, give the hand's distance.
const PALM_BONES = [
  [0, 5],
  [0, 9],
  [0, 17],
  [5, 17],
];
// A strike is timed from the most open the pinch was within this long before it caught.
const STRIKE_WINDOW = 0.15;

// Shape thresholds as ratios of hand size, with hysteresis between on and off.
export const SHAPE = {
  pinchOn: 0.3,
  pinchOff: 0.42,
  fistOn: 1.2,
  fistOff: 1.4,
  // A pinching index finger reaches the thumb in front of the palm; a fist's index
  // folds into it. This separates a pinch with the other fingers curled from a fist.
  fistIndex: 1.15,
};

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const span = (points) =>
  PALM_BONES.reduce(
    (sum, [a, b]) =>
      sum + Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y),
    0,
  );

/**
 * How near the hand is to the camera: the palm's size on screen over its size in metres,
 * both measured across the screen. Tilting the hand shrinks both alike, so only moving
 * nearer or farther changes it. Null without metric landmarks.
 */
export function closeness(points, world) {
  if (world?.length !== 21) return null;
  const metres = span(world);
  return metres > 0 ? span(points) / metres : null;
}

// One Euro filter: steady when still, responsive when moving (Casiez et al., 2012).
export class OneEuro {
  constructor({ minCutoff = 1.5, beta = 4, derivativeCutoff = 1 } = {}) {
    Object.assign(this, { minCutoff, beta, derivativeCutoff });
    this.value = null;
    this.derivative = 0;
    this.time = null;
  }
  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(value, time) {
    if (this.value === null || time <= this.time) {
      if (this.value === null) this.value = value;
      this.time = time;
      return this.value;
    }
    const dt = time - this.time;
    const raw = (value - this.value) / dt;
    this.derivative +=
      OneEuro.alpha(this.derivativeCutoff, dt) * (raw - this.derivative);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.derivative);
    this.value += OneEuro.alpha(cutoff, dt) * (value - this.value);
    this.time = time;
    return this.value;
  }
}

/** Shape of one hand from metric world landmarks (image landmarks as a fallback). */
export function handShape(points) {
  const size = distance(points[WRIST], points[MIDDLE_MCP]) || 1e-6;
  const curls = FINGERS.map(
    ([mcp, tip]) =>
      distance(points[tip], points[WRIST]) /
      (distance(points[mcp], points[WRIST]) || 1e-6),
  );
  return {
    pinch: distance(points[THUMB_TIP], points[INDEX_TIP]) / size,
    curl: curls.reduce((sum, value) => sum + value, 0) / curls.length,
    indexCurl: curls[0],
  };
}

/**
 * Associates detections with persistent hands, assigns roles, and reports features.
 * Positions are in the mirrored view: x grows to the performer's right, y downward.
 */
export class HandTracker {
  constructor({ leadSide = "Right", aspect = 4 / 3 } = {}) {
    this.leadSide = leadSide;
    this.aspect = aspect;
    this.tracks = [];
    this.nextId = 1;
  }

  update(hands, time) {
    const seen = hands.slice(0, 2).map((hand) => this.#observe(hand));
    const claimed = new Set();
    for (const [detection, match] of this.#associate(seen)) {
      let track = match;
      if (!track) {
        track = this.#create(detection);
        this.tracks.push(track);
      }
      claimed.add(track);
      this.#advance(track, detection, time);
    }
    // A brief dropout keeps the track so a returning hand keeps its role and filters.
    this.tracks = this.tracks
      .filter((track) => claimed.has(track) || time - track.seenAt < 0.5)
      .sort((a, b) => claimed.has(b) - claimed.has(a) || b.seenAt - a.seenAt)
      .slice(0, 2);
    for (const track of this.tracks) track.visible = claimed.has(track);
    this.#assignRoles();
    const result = {};
    for (const track of this.tracks)
      if (track.visible && track.role)
        result[track.role] = this.#features(track);
    return result;
  }

  // With at most two hands, trying every pairing finds the closest overall match.
  #associate(detections) {
    const cost = (detection, track) =>
      Math.hypot(detection.x - track.rawX, detection.y - track.rawY);
    let best = detections.map((d) => [d, null]),
      bestCost = Infinity;
    const orders = [
      [0, 1],
      [1, 0],
    ];
    for (const order of orders) {
      let total = 0;
      const pairs = detections.map((detection, i) => {
        const track = this.tracks[order[i]];
        if (!track || cost(detection, track) > 0.3) return [detection, null];
        total += cost(detection, track);
        return [detection, track];
      });
      // Every unmatched detection is penalized, so matching is preferred over new tracks.
      total += pairs.filter(([, track]) => !track).length * 0.3;
      if (total < bestCost) [best, bestCost] = [pairs, total];
    }
    return best;
  }

  #observe(hand) {
    const points = hand.points.map((p) => ({
      x: (1 - p.x) * this.aspect,
      y: p.y,
      z: p.z * this.aspect,
    }));
    const palm = PALM.reduce(
      (sum, index) => ({
        x: sum.x + points[index].x / PALM.length,
        y: sum.y + points[index].y / PALM.length,
      }),
      { x: 0, y: 0 },
    );
    const shapePoints = hand.world?.length === 21 ? hand.world : points;
    // The preview's mirror changes coordinates, not which hand was detected.
    const score = hand.score ?? 0.75;
    const right = hand.side === "Right" ? score : 1 - score;
    return {
      x: palm.x / this.aspect,
      y: palm.y,
      landmarks: points.map((p) => ({
        x: p.x / this.aspect,
        y: p.y,
        z: p.z / this.aspect,
      })),
      shape: handShape(shapePoints),
      closeness: closeness(points, hand.world),
      right,
    };
  }

  #create(detection) {
    const filters = {
      x: new OneEuro(),
      y: new OneEuro(),
      // On a log scale, so nearing and receding are smoothed alike.
      closeness: new OneEuro({ minCutoff: 1.5, beta: 1 }),
    };
    // Before the label settles, screen side is weak evidence of anatomical side.
    const prior = 0.5 + (detection.x - 0.5) * 0.4;
    return {
      id: this.nextId++,
      filters,
      rightBelief: prior,
      role: null,
      pinch: false,
      fist: false,
      pinches: [], // Recent [time, pinch distance] pairs, for strikes.
      strike: null,
      closeness: null,
      rawX: detection.x,
      rawY: detection.y,
      x: detection.x,
      y: detection.y,
      vy: 0,
      seenAt: -Infinity,
      visible: true,
    };
  }

  #advance(track, detection, time) {
    const { shape } = detection;
    const previousY = track.y;
    const previousTime = track.seenAt;
    track.rawX = detection.x;
    track.rawY = detection.y;
    track.x = track.filters.x.filter(detection.x, time);
    track.y = track.filters.y.filter(detection.y, time);
    const dt = time - previousTime;
    // Smooth finger motion relative to the palm. Recentring keeps the visible
    // hand attached to the exact palm position that drives the instrument.
    if (!track.landmarkFilters || dt > 0.2)
      track.landmarkFilters = detection.landmarks.map(() =>
        Object.fromEntries(
          ["x", "y", "z"].map((axis) => [
            axis,
            new OneEuro({ minCutoff: 4, beta: 8 }),
          ]),
        ),
      );
    const offsets = detection.landmarks.map((point, i) => ({
      x: track.landmarkFilters[i].x.filter(point.x - detection.x, time),
      y: track.landmarkFilters[i].y.filter(point.y - detection.y, time),
      z: track.landmarkFilters[i].z.filter(point.z, time),
    }));
    const centre = PALM.reduce(
      (sum, i) => ({
        x: sum.x + offsets[i].x / PALM.length,
        y: sum.y + offsets[i].y / PALM.length,
      }),
      { x: 0, y: 0 },
    );
    track.landmarks = offsets.map((point) => ({
      x: track.x + point.x - centre.x,
      y: track.y + point.y - centre.y,
      z: point.z,
    }));
    track.vy = dt > 0 && dt < 0.2 ? (track.y - previousY) / dt : 0;
    track.rightBelief += 0.15 * (detection.right - track.rightBelief);
    track.shape = shape;
    track.closeness =
      detection.closeness === null
        ? null
        : Math.exp(
            track.filters.closeness.filter(Math.log(detection.closeness), time),
          );
    // A fist also brings thumb and index together, so it overrides the pinch.
    track.fist = track.fist
      ? shape.curl < SHAPE.fistOff
      : shape.curl < SHAPE.fistOn && shape.indexCurl < SHAPE.fistIndex;
    const pinched = track.pinch;
    track.pinch =
      !track.fist &&
      (track.pinch
        ? shape.pinch < SHAPE.pinchOff
        : shape.pinch < SHAPE.pinchOn);
    // How quickly the pinch closed, in hand sizes per second: from the most open it was
    // lately to now, measured on the unfiltered shape so the strike adds no delay. Unknown
    // without an earlier frame to compare.
    track.pinches = track.pinches.filter(
      ([t]) => t < time && time - t <= STRIKE_WINDOW,
    );
    if (track.pinch && !pinched) {
      let widest = null;
      for (const frame of track.pinches)
        if (widest === null || frame[1] >= widest[1]) widest = frame;
      track.strike =
        widest === null
          ? null
          : Math.max(0, (widest[1] - shape.pinch) / (time - widest[0]));
    }
    track.pinches.push([time, shape.pinch]);
    track.seenAt = time;
  }

  #assignRoles() {
    const leadIsRight = this.leadSide === "Right";
    const [a, b] = this.tracks;
    if (a && b) {
      // Two hands always take different roles; the more right-looking one is the right
      // hand. Established roles swap only on clear evidence, so a label flicker cannot.
      const rightOf = (track) => (track.role === "lead") === leadIsRight;
      const settled = a.role && b.role && a.role !== b.role;
      const [right, left] = settled
        ? rightOf(a)
          ? [a, b]
          : [b, a]
        : a.rightBelief >= b.rightBelief
          ? [a, b]
          : [b, a];
      const swap = settled && left.rightBelief > right.rightBelief + 0.25;
      const [r, l] = swap ? [left, right] : [right, left];
      r.role = leadIsRight ? "lead" : "band";
      l.role = leadIsRight ? "band" : "lead";
      return;
    }
    if (!a) return;
    // A lone hand keeps its role until the evidence clearly says otherwise.
    const right =
      a.role === null
        ? a.rightBelief >= 0.5
        : (a.role === "lead") === leadIsRight
          ? a.rightBelief > 0.3
          : a.rightBelief > 0.7;
    a.role = right === leadIsRight ? "lead" : "band";
  }

  #features(track) {
    return {
      id: track.id,
      side: track.rightBelief >= 0.5 ? "Right" : "Left",
      x: track.x,
      y: track.y,
      vy: track.vy,
      pinch: track.pinch,
      fist: track.fist,
      shape: track.shape,
      landmarks: track.landmarks,
      // The latest pinch's strike, and the hand's smoothed nearness to the camera.
      strike: track.strike,
      closeness: track.closeness,
    };
  }
}
