// Tracker landmarks to stable, smoothed hand features in the mirrored view.
// MediaPipe labels handedness as if the image were mirrored; the tracker receives
// unmirrored camera frames, so its "Left" is the performer's right hand.

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
    // MediaPipe's label is flipped for unmirrored input; its score is its certainty.
    const score = hand.score ?? 0.75;
    const right = hand.side === "Left" ? score : 1 - score;
    return {
      x: palm.x / this.aspect,
      y: palm.y,
      shape: handShape(shapePoints),
      right,
    };
  }

  #create(detection) {
    const filters = { x: new OneEuro(), y: new OneEuro() };
    // Before the label settles, screen side is weak evidence of anatomical side.
    const prior = 0.5 + (detection.x - 0.5) * 0.4;
    return {
      id: this.nextId++,
      filters,
      rightBelief: prior,
      role: null,
      pinch: false,
      fist: false,
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
    track.vy = dt > 0 && dt < 0.2 ? (track.y - previousY) / dt : 0;
    track.rightBelief += 0.15 * (detection.right - track.rightBelief);
    track.shape = shape;
    // A fist also brings thumb and index together, so it overrides the pinch.
    track.fist = track.fist
      ? shape.curl < SHAPE.fistOff
      : shape.curl < SHAPE.fistOn && shape.indexCurl < SHAPE.fistIndex;
    track.pinch =
      !track.fist &&
      (track.pinch
        ? shape.pinch < SHAPE.pinchOff
        : shape.pinch < SHAPE.pinchOn);
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
    };
  }
}
