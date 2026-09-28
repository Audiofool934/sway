// Musical time on the AudioContext clock. Times are seconds; positions are beats.

export class Transport {
  constructor(tempo, startTime) {
    this.tempo = tempo;
    this.startTime = startTime;
  }
  get beatSeconds() {
    return 60 / this.tempo;
  }
  beatAt(time) {
    return (time - this.startTime) / this.beatSeconds;
  }
  timeAt(beat) {
    return this.startTime + beat * this.beatSeconds;
  }
}

// Swing delays every second sixteenth to `amount` of its eighth note (0.5 is straight).
// The warp is continuous, so it applies to any position, not only grid points.
export function applySwing(beat, amount) {
  const eighth = Math.floor(beat * 2);
  const within = beat * 2 - eighth;
  const swung =
    within < 0.5
      ? within * 2 * amount
      : amount + (within - 0.5) * 2 * (1 - amount);
  return (eighth + swung) / 2;
}

export function removeSwing(beat, amount) {
  const eighth = Math.floor(beat * 2);
  const within = beat * 2 - eighth;
  const straight =
    within < amount
      ? within / (2 * amount)
      : 0.5 + (within - amount) / (2 * (1 - amount));
  return (eighth + straight) / 2;
}

// Smallest multiple of `unit` at or after `beat`, tolerant of floating-point dust.
export const ceilTo = (beat, unit) => Math.ceil(beat / unit - 1e-9) * unit + 0;

/**
 * When a performed note should sound.
 * `eventTime` is the best estimate of when the gesture happened, already corrected
 * for tracking delay. The note lands on the grid point nearest that moment when it is
 * still ahead, plays at once when that point passed within `tolerance`, and otherwise
 * waits for the next grid point so a clearly late gesture still lands in time.
 */
export function alignOnset({
  transport,
  swing,
  grid,
  eventTime,
  now,
  lead = 0.005,
  tolerance = 0.05,
}) {
  const earliest = now + lead;
  if (!grid) return earliest;
  const at = (index) => transport.timeAt(applySwing(index * grid, swing));
  const index = Math.round(
    removeSwing(transport.beatAt(eventTime), swing) / grid,
  );
  const nearest = at(index);
  if (nearest >= earliest) return nearest;
  if (now - nearest <= tolerance) return earliest;
  let next = index + 1;
  while (at(next) < earliest) next++;
  return at(next);
}
