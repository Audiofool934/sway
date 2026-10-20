// The conductor's gestures (docs/v2-design.md): the same in every world.
// The right hand conducts: the size of its motion sets the dynamics, its speed the energy,
// and its shape the articulation; a fist or stillness hushes the music. The left hand
// brings a voice forward: its place chooses the voice, and its height how far. Both hands
// held up prepare, and bringing them down moves on. One hand conducts as the right hand,
// and the left hand's balance holds while it is out of view.
const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const WINDOW = 0.8; // Seconds of the right hand's motion that set dynamics and energy.
const SIZE = 0.45; // A motion this wide, in frame widths, is the loudest.
const SPEED = 1.2; // A hand this fast, in frame widths per second, is the most driving.
const MOVING = 0.035; // Hand speed that counts as motion.
const HUSH = 0.65; // Seconds without motion before stillness hushes.
// The left hand's reach, left to right, across the three voices, so it need not cross
// the right hand; and from low to raised, for how far the voice comes forward.
const REACH = [0.08, 0.72];
const LOW = 0.8;
const RAISED = 0.25;
// Preparing: both hands above UP for PREPARE seconds. Moving on: both then fall below
// DOWN within DROP seconds of leaving the top.
const UP = 0.3;
const DOWN = 0.55;
const PREPARE = 0.25;
const DROP = 0.6;
// A pinch's thumb-to-index distance, in hand sizes, from an open palm's to a pinch's.
const OPEN = 0.6;
const PINCHED = 0.2;

export class ConductorControls {
  constructor({ leftHanded = false } = {}) {
    this.leftHanded = leftHanded;
    this.trail = []; // [time, x, y] of the conducting hand.
    this.dynamics = 0;
    this.energy = 0;
    this.voice = 0.5;
    this.forward = 0;
    this.articulation = 0;
    this.hush = true;
    this.cues = 0;
    this.prepared = false;
    this.upSince = null;
    this.leftTop = null;
    this.lastMotion = -Infinity;
    this.lastTime = null;
    this.previous = null;
    this.seq = 0;
    this.seen = false;
    this.points = [];
  }

  /** Move on from another input, such as a double-click. */
  cue() {
    this.cues++;
  }

  // The conducting hand and the balancing one, by the tracker's labels, or by place.
  #roles(hands) {
    const conducting = this.leftHanded ? "Left" : "Right";
    if (hands.length < 2) return [hands[0] ?? null, null];
    const [a, b] = hands;
    const sideOf = (hand, other) =>
      hand.side && hand.side !== other.side
        ? hand.side
        : hand.x > other.x
          ? "Right"
          : "Left";
    return sideOf(a, b) === conducting ? [a, b] : [b, a];
  }

  update(hands, time) {
    const dt =
      this.lastTime === null ? 1 / 30 : clamp(time - this.lastTime, 0.001, 0.1);
    this.lastTime = time;
    const ease = (seconds) => 1 - Math.exp(-dt / seconds);
    this.points = hands;
    this.seen = hands.length > 0;
    const [right, left] = this.#roles(hands);

    // The conducting hand: the size and speed of its recent motion.
    if (right) {
      const step = this.previous
        ? Math.hypot(right.x - this.previous.x, right.y - this.previous.y)
        : 0;
      if (this.previous && step / dt > MOVING) this.lastMotion = time;
      if (!this.previous) this.lastMotion = time;
      this.previous = { x: right.x, y: right.y };
      this.trail.push([time, right.x, right.y]);
    } else this.previous = null;
    this.trail = this.trail.filter(([at]) => time - at <= WINDOW);
    let size = 0,
      path = 0;
    if (this.trail.length > 1) {
      const xs = this.trail.map(([, x]) => x);
      const ys = this.trail.map(([, , y]) => y);
      size = Math.hypot(
        Math.max(...xs) - Math.min(...xs),
        Math.max(...ys) - Math.min(...ys),
      );
      for (let i = 1; i < this.trail.length; i++)
        path += Math.hypot(
          this.trail[i][1] - this.trail[i - 1][1],
          this.trail[i][2] - this.trail[i - 1][2],
        );
      path /= Math.max(0.1, this.trail.at(-1)[0] - this.trail[0][0]);
    }
    const loud = clamp(size / SIZE);
    this.dynamics +=
      (loud - this.dynamics) * ease(loud > this.dynamics ? 0.12 : 0.5);
    const drive = clamp(path / SPEED);
    this.energy +=
      (drive - this.energy) * ease(drive > this.energy ? 0.15 : 0.5);
    this.hush = !right || right.fist || time - this.lastMotion > HUSH;
    const pinch = right?.shape?.pinch;
    const short =
      typeof pinch === "number"
        ? clamp((OPEN - pinch) / (OPEN - PINCHED))
        : right?.pinch
          ? 1
          : 0;
    if (right) this.articulation += (short - this.articulation) * ease(0.15);

    // Both hands up prepare; bringing them down moves on.
    const bothUp = right && left && right.y < UP && left.y < UP;
    if (bothUp) {
      this.upSince ??= time;
      this.leftTop = null;
      if (time - this.upSince >= PREPARE) this.prepared = true;
    } else if (this.prepared) {
      this.leftTop ??= time;
      const bothDown = right && left && right.y > DOWN && left.y > DOWN;
      if (bothDown) {
        this.cues++;
        this.prepared = false;
      } else if (time - this.leftTop > DROP) this.prepared = false;
      this.upSince = null;
    } else this.upSince = null;

    // The balancing hand, which holds still while both hands are up.
    if (left && this.upSince === null && !this.prepared) {
      const place = clamp((left.x - REACH[0]) / (REACH[1] - REACH[0]));
      const height = clamp((LOW - left.y) / (LOW - RAISED));
      this.voice += (place - this.voice) * ease(0.15);
      this.forward += (height - this.forward) * ease(0.15);
    }
    this.seq++;
    return this.snapshot();
  }

  snapshot() {
    return {
      seq: this.seq,
      dynamics: this.dynamics,
      energy: this.energy,
      voice: this.voice,
      forward: this.forward,
      articulation: this.articulation,
      hush: this.hush,
      prepared: this.prepared,
      cue: this.cues,
    };
  }
}

/** The balanced orchestra's weight and the three voices', as piece.voice_weights. */
export function voiceWeights(voice, forward) {
  const position = clamp(voice) * 2;
  const lower = Math.min(1, Math.floor(position));
  const share = position - lower;
  const voices = [0, 0, 0];
  voices[lower] = 1 - share;
  voices[lower + 1] += share;
  const f = clamp(forward);
  return [1 - f, ...voices.map((v) => f * v)];
}

/** Where each voice's label sits across the view: where the left hand reaches it. */
export const VOICE_PLACES = [0, 0.5, 1].map(
  (at) => REACH[0] + at * (REACH[1] - REACH[0]),
);
