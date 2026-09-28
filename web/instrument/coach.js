// The music-game tutorial: setup (reach and timing), then lessons whose targets
// scroll toward the hands. Charts start one bar after the band does, so every
// lesson opens with a count-in.

import { Judge, LESSONS, calibrate, passed } from "./tutorial.js";

const COUNT_IN = 4; // Beats before a chart's first target.
const HOLD_SECONDS = 1; // A reach is recorded after the hand rests this long.
const TIMING_TAPS = 8;

// What each lesson lets the band hand do; locked controls keep attention on the lesson.
const ALLOWED = {
  timing: [],
  notes: [],
  melody: [],
  band: ["energy", "cut"],
  piece: ["energy", "cut", "capture", "end"],
};

export class Coach {
  /**
   * hooks: startEngine({ level }) -> engine, stopEngine(), showCard(spec), hideCard(),
   * setRange(range), setCompensation(seconds or null), camera(), leadName(), now(),
   * beatSeconds(), currentRung(), engineState(), engineLevel(), endEngine(), freePlay(),
   * record(id, summary)
   */
  constructor(hooks) {
    this.hooks = hooks;
    this.phase = "idle";
    this.lessonIndex = 0;
    this.judge = null;
    this.hold = null;
    this.reach = {};
    this.taps = [];
  }

  get active() {
    return this.phase !== "idle";
  }

  get lesson() {
    return LESSONS[this.lessonIndex];
  }

  /** Whether a band-hand control reaches the engine during the current step. */
  allows(type) {
    if (this.phase !== "lesson" && this.phase !== "timing") return true;
    const id = this.phase === "timing" ? "timing" : this.lesson.id;
    return ALLOWED[id].includes(type);
  }

  begin() {
    this.lessonIndex = 0;
    if (this.hooks.camera()) this.#reachStep("high");
    else this.#timingIntro();
  }

  /** Go straight to a lesson's introduction, skipping setup. */
  openLesson(index) {
    this.#lessonIntro(Math.max(0, Math.min(LESSONS.length - 1, index)));
  }

  exit() {
    this.phase = "idle";
    this.judge = null;
    this.hooks.stopEngine();
    this.hooks.hideCard();
  }

  // Setup, step 1 and 2: the comfortable top and bottom of the lead hand's reach.

  #reachStep(which) {
    this.phase = which === "high" ? "reach-high" : "reach-low";
    this.hold = null;
    const hand = this.hooks.leadName();
    this.hooks.showCard({
      step: "Setup · 1 of 2",
      title: "Fit the ladder to your reach",
      body:
        which === "high"
          ? `Raise your ${hand} hand as high as is comfortable, and hold it there for a moment.`
          : `Now lower your ${hand} hand as far as is comfortable, and hold it there.`,
      compact: true,
      actions: [
        {
          label: "Skip setup",
          secondary: true,
          run: () => this.#timingIntro(),
        },
      ],
    });
  }

  /** Reach steps watch the lead hand; it counts once it has rested for a second. */
  onHands(lead, time) {
    if (this.phase !== "reach-high" && this.phase !== "reach-low") return;
    // The low reach only counts once the hand has clearly left the high one.
    const tooHigh =
      this.phase === "reach-low" && lead && lead.y - this.reach.top < 0.3;
    if (!lead || tooHigh) {
      this.hold = null;
      return;
    }
    if (!this.hold || Math.abs(lead.y - this.hold.y) > 0.03) {
      this.hold = { y: lead.y, since: time };
      return;
    }
    if (time - this.hold.since < HOLD_SECONDS) return;
    if (this.phase === "reach-high") {
      this.reach.top = this.hold.y;
      this.#reachStep("low");
      return;
    }
    const bottom = this.hold.y;
    // A short span would make rungs too small to hit; keep the default then.
    if (bottom - this.reach.top >= 0.3)
      this.hooks.setRange({ top: this.reach.top, bottom });
    this.#timingIntro();
  }

  get holdProgress() {
    if (
      !this.hold ||
      (this.phase !== "reach-high" && this.phase !== "reach-low")
    )
      return 0;
    return Math.min(1, (this.hooks.now() - this.hold.since) / HOLD_SECONDS);
  }

  // Setup, step 3: timing. Pinches on the beat reveal the player's offset.

  #timingIntro() {
    this.phase = "timing-intro";
    this.hooks.stopEngine();
    this.hooks.showCard({
      step: "Setup · 2 of 2",
      title: "Find your timing",
      body: `After a bar of count-in, pinch with your ${this.hooks.leadName()} hand on each of the next ${TIMING_TAPS} beats. Any note will do.`,
      actions: [
        { label: "Start", run: () => this.#timingStart() },
        { label: "Skip", secondary: true, run: () => this.#lessonIntro(0) },
      ],
    });
  }

  #timingStart() {
    this.phase = "timing";
    this.taps = [];
    this.hooks.setCompensation(null);
    this.hooks.hideCard();
    this.hooks.startEngine({ level: 1 });
  }

  // Lessons.

  #lessonIntro(index) {
    this.phase = "lesson-intro";
    this.lessonIndex = index;
    this.hooks.stopEngine();
    const lesson = this.lesson;
    this.hooks.showCard({
      step: `Lesson ${index + 1} of ${LESSONS.length}`,
      title: lesson.title,
      body: lesson.goal,
      actions: [
        { label: "Start lesson", run: () => this.#lessonStart() },
        { label: "Back to free play", secondary: true, run: () => this.exit() },
      ],
    });
  }

  #lessonStart() {
    this.phase = "lesson";
    this.judge = new Judge(this.lesson, {
      beatSeconds: this.hooks.beatSeconds(),
    });
    this.hooks.hideCard();
    this.hooks.startEngine({ level: this.lesson.level });
  }

  /** Chart targets on the absolute beat timeline, for drawing. */
  get targets() {
    if (this.phase !== "lesson" || !this.judge) {
      if (this.phase !== "timing") return [];
      return Array.from({ length: TIMING_TAPS }, (_, i) => ({
        kind: "note",
        beat: COUNT_IN + i,
        beats: 0.5,
        rung: this.hooks.currentRung() ?? 4,
        result: this.taps.some((beat) => Math.abs(beat - (COUNT_IN + i)) < 0.5)
          ? { grade: "good" }
          : null,
      }));
    }
    return this.judge.targets.map((target) => ({
      ...target,
      beat: target.beat + COUNT_IN,
    }));
  }

  /** A short line for the heads-up display while a step runs. */
  get progress() {
    if (this.phase === "timing")
      return `Pinch on each beat · ${this.taps.length} of ${TIMING_TAPS}`;
    if (this.phase !== "lesson" && this.phase !== "lesson-ending") return null;
    const { hit, total } = this.judge.summary();
    return `${this.lesson.title} · ${hit} of ${total}`;
  }

  onNote(event) {
    if (event.gesture === undefined) return;
    if (this.phase === "timing") {
      const beat = event.gesture;
      if (
        !event.legato &&
        beat > COUNT_IN - 0.5 &&
        beat < COUNT_IN + TIMING_TAPS - 0.5
      )
        this.taps.push(beat);
      return;
    }
    if (this.phase !== "lesson") return;
    this.judge.note({
      beat: event.gesture - COUNT_IN,
      rung: event.rung,
      legato: Boolean(event.legato),
    });
  }

  /** Band-hand controls, at the beat being heard when they happened. */
  onControl(event, beat) {
    if (this.phase !== "lesson") return;
    const at = beat - COUNT_IN;
    if (event.type === "cut") this.judge.cut({ beat: at, on: event.on });
    else if (event.type === "end") this.judge.event("end", at);
  }

  /** A capture counts only when it actually looped something. */
  onCapture(beat) {
    if (this.phase === "lesson") this.judge.event("capture", beat - COUNT_IN);
  }

  tick(beat) {
    if (this.phase === "timing" && beat > COUNT_IN + TIMING_TAPS + 0.5)
      return this.#timingDone();
    if (this.phase === "lesson") {
      this.judge.level(beat - COUNT_IN, this.hooks.engineLevel());
      this.judge.expire(beat - COUNT_IN);
      const end = COUNT_IN + this.lesson.bars * 4;
      // The player may end the piece themselves; results follow its final chord.
      const ended = this.hooks.engineState() === "finished";
      if (ended || beat > end + 0.5 || (this.judge.done && beat > COUNT_IN)) {
        // Let the band resolve, and show the results as the final chord lands.
        this.phase = "lesson-ending";
        this.hooks.endEngine();
      }
    }
    if (
      this.phase === "lesson-ending" &&
      this.hooks.engineState() === "finished"
    )
      this.#results();
  }

  #timingDone() {
    const offset = calibrate(this.taps, this.hooks.beatSeconds());
    this.hooks.stopEngine();
    if (offset === null) {
      this.phase = "timing-intro";
      this.hooks.showCard({
        step: "Setup · 2 of 2",
        title: "Let's try that again",
        body: `Sway heard ${this.taps.length} pinches. Pinch once on each beat after the count-in.`,
        actions: [
          { label: "Try again", run: () => this.#timingStart() },
          { label: "Skip", secondary: true, run: () => this.#lessonIntro(0) },
        ],
      });
      return;
    }
    this.hooks.setCompensation(offset);
    const ms = Math.round(offset * 1000);
    this.phase = "timing-done";
    this.hooks.showCard({
      step: "Setup complete",
      title: "Your instrument is tuned to you",
      body:
        Math.abs(ms) < 15
          ? "Your pinches landed right on the beat, so no timing correction is needed."
          : `Your pinches landed ${Math.abs(ms)} ms ${ms > 0 ? "after" : "before"} the beat on average; Sway now corrects for that.`,
      actions: [
        { label: "Continue to lesson 1", run: () => this.#lessonIntro(0) },
      ],
    });
  }

  #results() {
    const summary = this.judge.summary();
    this.phase = "results";
    this.hooks.record?.(this.lesson.id, summary);
    const ok = passed(summary);
    const last = this.lessonIndex === LESSONS.length - 1;
    const next = () =>
      last ? this.#graduate() : this.#lessonIntro(this.lessonIndex + 1);
    const lines = Object.entries(summary.kinds).map(([kind, stats]) => {
      const name =
        {
          note: "Notes",
          legato: "Legato moves",
          energy: "Energy changes",
          cut: "Cuts",
          capture: "Loop",
          end: "Ending",
        }[kind] ?? kind;
      const timing =
        stats.meanErrorMs === null || kind === "energy"
          ? ""
          : `, ±${Math.round(stats.meanErrorMs)} ms`;
      return `${name}: ${stats.hit} of ${stats.total}${timing}`;
    });
    this.hooks.showCard({
      step: `Lesson ${this.lessonIndex + 1} of ${LESSONS.length}`,
      title: ok
        ? summary.perfect > summary.total / 2
          ? "Beautiful"
          : "Nicely done"
        : "Almost",
      body: ok
        ? `You hit ${summary.hit} of ${summary.total} targets.`
        : `You hit ${summary.hit} of ${summary.total} targets. Try once more, or move on when you're ready.`,
      details: lines,
      actions: ok
        ? [
            { label: last ? "Finish" : "Next lesson", run: next },
            {
              label: "Try again",
              secondary: true,
              run: () => this.#lessonStart(),
            },
          ]
        : [
            { label: "Try again", run: () => this.#lessonStart() },
            {
              label: last ? "Finish" : "Next lesson",
              secondary: true,
              run: next,
            },
          ],
    });
  }

  #graduate() {
    this.phase = "idle";
    this.hooks.stopEngine();
    this.hooks.showCard({
      step: "Tutorial complete",
      title: "You can play Sway",
      body: "Everything you practised works together in free play. Start a piece whenever you're ready.",
      actions: [{ label: "Start playing", run: () => this.hooks.freePlay() }],
    });
  }
}
