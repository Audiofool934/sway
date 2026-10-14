// The hands steer the music's direction; the model writes every note.
// Height, activity and spread are what docs/motion-to-music.md measured as "steered".
const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
export const REST = 0.05; // steering.REST: activity below this is stillness.
const HOLD = 0.65; // Seconds of stillness before the music rests.
const MOVING = 0.035; // Hand speed, in frame widths per second, that counts as motion.
const FLOOR = 0.15; // The activity of the slowest movement that still plays.

export class SteeredControls {
  constructor() {
    this.previous = new Map();
    this.height = 0.5;
    this.spread = 0.5;
    this.motion = 0;
    this.activity = 0;
    this.seq = 0;
    this.lastMotion = -Infinity;
    this.lastTime = null;
    this.seen = false;
    this.points = [];
  }

  update(hands, time) {
    const dt =
      this.lastTime === null ? 1 / 30 : clamp(time - this.lastTime, 0.001, 0.1);
    this.lastTime = time;
    const ease = (seconds) => 1 - Math.exp(-dt / seconds);
    this.points = hands.filter((h) => !h.fist);
    let speed = 0;
    const next = new Map();
    for (const hand of this.points) {
      const previous = this.previous.get(hand.id);
      if (previous && time - previous.time < 0.2) {
        const elapsed = Math.max(0.001, time - previous.time);
        speed = Math.max(
          speed,
          Math.hypot(hand.x - previous.x, hand.y - previous.y) / elapsed,
        );
      }
      next.set(hand.id, { ...hand, time });
    }
    this.previous = next;
    const wasSeen = this.seen;
    this.seen = this.points.length > 0;
    if (this.seen && !wasSeen) this.lastMotion = time;
    if (speed > MOVING) this.lastMotion = time;
    this.motion += ((this.seen ? speed : 0) - this.motion) * ease(0.25);
    if (this.seen) {
      const y =
        this.points.reduce((sum, h) => sum + h.y, 0) / this.points.length;
      this.height += (clamp((0.82 - y) / 0.64) - this.height) * ease(0.15);
      const extent =
        this.points.length > 1
          ? Math.abs(this.points[0].x - this.points[1].x) / 0.65
          : (this.points[0].x - 0.15) / 0.7;
      this.spread += (clamp(extent) - this.spread) * ease(0.15);
    }
    const playing = this.seen && time - this.lastMotion < HOLD;
    const target = playing
      ? FLOOR + (1 - FLOOR) * clamp(this.motion / 0.75)
      : 0;
    this.activity +=
      (target - this.activity) * ease(target > this.activity ? 0.12 : 0.25);
    this.seq++;
    return this.snapshot();
  }

  snapshot() {
    return {
      seq: this.seq,
      height: this.height,
      activity: this.activity,
      spread: this.spread,
    };
  }
}
