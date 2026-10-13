// One musical controller for camera and pointer input. Neither hand has a fixed role.
const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
export const PITCHES = [
  48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72, 74, 76,
];

export class ThereminControls {
  constructor() {
    this.previous = new Map();
    this.pitchIndex = 5;
    this.spread = 0.3;
    this.grain = 0;
    this.energy = 0;
    this.accent = 0;
    this.seq = 0;
    this.lastMotion = -Infinity;
    this.lastAccent = -Infinity;
    this.lastTime = null;
    this.seen = false;
    this.points = [];
  }

  update(hands, time) {
    const dt =
      this.lastTime === null ? 1 / 30 : clamp(time - this.lastTime, 0.001, 0.1);
    this.lastTime = time;
    this.points = hands.filter((h) => !h.fist);
    let speed = 0,
      pulse = false;
    const next = new Map();
    for (const hand of this.points) {
      const previous = this.previous.get(hand.id);
      let vx = 0,
        vy = 0,
        velocity = 0;
      let directionX = previous?.directionX ?? 0;
      let directionY = previous?.directionY ?? 0;
      let armed = previous?.armed ?? true;
      if (previous && time - previous.time < 0.2) {
        const elapsed = time - previous.time;
        vx = (hand.x - previous.x) / Math.max(0.001, elapsed);
        vy = (hand.y - previous.y) / Math.max(0.001, elapsed);
        velocity = Math.hypot(vx, vy);
        const dot = vx * directionX + vy * directionY;
        const reversal =
          dot < -0.2 * velocity * Math.hypot(directionX, directionY);
        const attack = velocity > 0.85 && armed;
        if (velocity > 0.32 && (reversal || attack)) pulse = true;
        if (velocity > 0.32) [directionX, directionY] = [vx, vy];
        if (velocity < 0.2) armed = true;
        else if (attack) armed = false;
      }
      speed = Math.max(speed, velocity);
      next.set(hand.id, {
        ...hand,
        time,
        vx,
        vy,
        speed: velocity,
        directionX,
        directionY,
        armed,
      });
    }
    this.previous = next;
    const wasSeen = this.seen;
    this.seen = this.points.length > 0;
    if (this.seen && !wasSeen) this.lastMotion = time;
    if (speed > 0.035) this.lastMotion = time;
    if (pulse && time - this.lastAccent > 0.18) {
      this.accent++;
      this.grain = clamp(this.grain + 0.48);
      this.lastAccent = time;
    }
    // Repeated short motions build articulation; a long sweep returns to bowing.
    this.grain *= Math.exp(-dt / 1.5);
    if (this.seen) {
      const y =
        this.points.reduce((sum, h) => sum + h.y, 0) / this.points.length;
      const position = clamp((0.82 - y) / 0.64) * (PITCHES.length - 1);
      if (Math.abs(position - this.pitchIndex) > 0.7)
        this.pitchIndex = Math.round(position);
      const extent =
        this.points.length > 1
          ? Math.abs(this.points[0].x - this.points[1].x) / 0.65
          : (this.points[0].x - 0.15) / 0.7;
      this.spread += (clamp(extent) - this.spread) * (1 - Math.exp(-dt / 0.15));
    }
    const still = Math.max(0, time - this.lastMotion - 0.65);
    const target = this.seen
      ? (0.42 + 0.5 * clamp(speed / 0.75)) * Math.exp(-still / 0.5)
      : 0;
    this.energy +=
      (target - this.energy) *
      (1 - Math.exp(-dt / (target > this.energy ? 0.055 : 0.18)));
    this.seq++;
    return this.snapshot();
  }

  snapshot() {
    return {
      seq: this.seq,
      pitch: PITCHES[this.pitchIndex],
      spread: this.spread,
      grain: this.grain,
      energy: this.energy,
      active: this.seen && this.energy > 0.025,
      accent: this.accent,
    };
  }
}
