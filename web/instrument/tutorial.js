// Lessons as short charts of real music, and the judge that scores them.
// Beats count from the lesson's first downbeat; rungs index the world's ladder.
// The same judging produces per-gesture reliability numbers for the design itself.

// [beat, rung, beats, legato]: legato notes are reached by moving while pinched.
const note = ([beat, rung, beats = 1, legato = false]) => ({
  kind: "note",
  beat,
  rung,
  beats,
  legato,
});

export const LESSONS = [
  {
    id: "notes",
    title: "Play notes",
    goal: "Pinch as each note reaches the line. Higher hand, higher note.",
    level: 1,
    bars: 8,
    // Three rungs, one note every two beats, then one every beat.
    targets: [
      [0, 5],
      [2, 4],
      [4, 3],
      [6, 4],
      [8, 5],
      [10, 5],
      [12, 4],
      [14, 3],
      [16, 3],
      [17, 4],
      [18, 5],
      [20, 4],
      [24, 5],
      [25, 4],
      [26, 3],
      [28, 4, 2],
    ].map(note),
  },
  {
    id: "melody",
    title: "Draw a melody",
    goal: "Keep the pinch and move to each new note without letting go.",
    level: 2,
    bars: 8,
    targets: [
      [0, 4],
      [1, 5, 1, true],
      [2, 7, 2, true],
      [8, 7],
      [9, 6, 1, true],
      [10, 5, 1, true],
      [11, 4, 1, true],
      [16, 2],
      [17, 3, 1, true],
      [18, 4, 2, true],
      [24, 5],
      [25, 4, 1, true],
      [26, 3, 1, true],
      [27, 4, 3, true],
    ].map(note),
  },
  {
    id: "band",
    title: "Lead the band",
    goal: "Raise and lower your band hand to set the energy. Make a fist to cut the band, and open it to bring them back.",
    level: 1,
    bars: 10,
    targets: [
      { kind: "energy", beat: 8, level: 2 },
      { kind: "energy", beat: 16, level: 3 },
      { kind: "energy", beat: 24, level: 4 },
      { kind: "cut", beat: 28, on: true },
      { kind: "cut", beat: 32, on: false },
      { kind: "energy", beat: 36, level: 1 },
    ],
  },
  {
    id: "piece",
    title: "Make a piece",
    goal: "Play a phrase, pinch and hold with your band hand to loop it, play over it, then end with two fists.",
    level: 2,
    bars: 16,
    targets: [
      ...[
        [0, 4],
        [1, 5, 1, true],
        [2, 7, 2, true],
        [5, 6],
        [6, 5, 2, true],
        [8, 4],
        [9, 3, 1, true],
        [10, 2, 2, true],
        [13, 3],
        [14, 4, 2, true],
      ].map(note),
      { kind: "capture", beat: 16 },
      { kind: "end", beat: 16 },
    ],
  },
];

export const GRADES = { perfect: 60, good: 150 }; // Milliseconds either side.

export class Judge {
  constructor(lesson, { beatSeconds }) {
    this.lesson = lesson;
    this.beatMs = beatSeconds * 1000;
    this.targets = lesson.targets.map((target, id) => ({
      ...target,
      id,
      result: null,
    }));
  }

  // The nearest open target of a kind within the window, measured in beats.
  #nearest(kind, beat, window, accept = () => true) {
    let best = null;
    for (const target of this.targets) {
      if (target.kind !== kind || target.result || !accept(target)) continue;
      const error = beat - target.beat;
      if (Math.abs(error) > window) continue;
      if (!best || Math.abs(error) < Math.abs(best.error))
        best = { target, error };
    }
    return best;
  }

  #grade(errorBeats) {
    const ms = Math.abs(errorBeats * this.beatMs);
    return ms <= GRADES.perfect
      ? "perfect"
      : ms <= GRADES.good
        ? "good"
        : "late";
  }

  /** A played note: `beat` is when the gesture happened, before grid alignment. */
  note({ beat, rung, legato }) {
    const found = this.#nearest("note", beat, 0.5);
    if (!found) return null;
    const { target, error } = found;
    const grade = target.rung !== rung ? "wrong" : this.#grade(error);
    if (grade === "late" || (grade === "wrong" && Math.abs(error) > 0.25))
      return null;
    target.result = {
      grade,
      errorMs: error * this.beatMs,
      legato: Boolean(legato),
    };
    return target;
  }

  /**
   * Energy is judged by what the band plays: a target is met when the band is at
   * its level once its downbeat has passed, however early the change was asked for.
   */
  level(beat, level) {
    for (const target of this.targets)
      if (
        target.kind === "energy" &&
        !target.result &&
        beat >= target.beat + 0.25
      )
        target.result = { grade: level === target.level ? "good" : "miss" };
  }

  cut({ beat, on }) {
    const found = this.#nearest("cut", beat, 1, (target) => target.on === on);
    if (!found) return null;
    found.target.result = {
      grade:
        this.#grade(found.error) === "late" ? "good" : this.#grade(found.error),
      errorMs: found.error * this.beatMs,
    };
    return found.target;
  }

  /** Capture and ending only need to happen after their cue. */
  event(kind, beat) {
    const target = this.targets.find(
      (t) => t.kind === kind && !t.result && beat >= t.beat - 1,
    );
    if (!target) return null;
    target.result = { grade: "good", errorMs: 0 };
    return target;
  }

  /** Targets whose time has passed without a result are misses. */
  expire(beat) {
    for (const target of this.targets)
      if (!target.result && beat > target.beat + this.#lateness(target))
        target.result = { grade: "miss" };
  }

  #lateness(target) {
    if (target.kind === "note") return 0.5;
    if (target.kind === "energy") return Infinity; // Judged by level().
    if (target.kind === "cut") return 1;
    return Infinity; // Capture and ending wait for the player.
  }

  get done() {
    return this.targets.every((target) => target.result);
  }

  summary() {
    const byKind = {};
    for (const target of this.targets) {
      const kind = target.legato ? "legato" : target.kind;
      const entry = (byKind[kind] ??= { total: 0, hit: 0, errors: [] });
      entry.total++;
      const grade = target.result?.grade;
      if (grade === "perfect" || grade === "good") {
        entry.hit++;
        entry.errors.push(Math.abs(target.result.errorMs));
      }
    }
    const kinds = Object.fromEntries(
      Object.entries(byKind).map(([kind, { total, hit, errors }]) => [
        kind,
        {
          total,
          hit,
          rate: total ? hit / total : 0,
          meanErrorMs: errors.length
            ? errors.reduce((a, b) => a + b, 0) / errors.length
            : null,
        },
      ]),
    );
    const total = this.targets.length;
    const hit = Object.values(kinds).reduce((sum, kind) => sum + kind.hit, 0);
    const perfect = this.targets.filter(
      (t) => t.result?.grade === "perfect",
    ).length;
    return { total, hit, perfect, rate: total ? hit / total : 0, kinds };
  }
}

/** A lesson passes when most targets are hit. */
export const passed = (summary) => summary.rate >= 0.7;

/**
 * Timing calibration: the median offset between pinches and the beats they aimed at.
 * Positive means the player's gestures register late, so later gestures are pulled earlier.
 */
export function calibrate(beats, beatSeconds) {
  const offsets = beats
    .map((beat) => beat - Math.round(beat))
    .sort((a, b) => a - b);
  if (offsets.length < 4) return null;
  const median = offsets[Math.floor(offsets.length / 2)];
  return Math.max(-0.15, Math.min(0.15, median * beatSeconds));
}
