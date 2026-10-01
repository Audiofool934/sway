// The performance engine: a lookahead scheduler on the AudioContext clock that turns
// control events into band, loop, and lead sounds. Control times arrive in
// performance.now() seconds and are mapped to the audio timeline as heard.

import { answerEvents, answerNotes, harmonyNotes } from "./arrange.js";
import { STEPS_PER_BAR, bandEnding, bandStep, progressionFor } from "./band.js";
import { Transport, alignOnset, applySwing, removeSwing } from "./clock.js";
import { Looper } from "./looper.js";
import { DRUM_NOTES } from "./midi.js";
import { TYPICAL_VELOCITY, WORLD, chordAt, cycleBeats } from "./theory.js";

const LOOKAHEAD = 0.12;
const TICK_MS = 20;
// The least time before a generated bar starts for it to be placed.
const PLACE_MARGIN = 0.05;
const STEP = 0.25;
const LOOP_PANS = [-0.35, 0.35, -0.15, 0.15];
// A note joined to the one before it is logged a little softer, as it is not struck again.
const LEGATO = 0.82;

export class Engine {
  constructor(
    ctx,
    synth,
    {
      world = WORLD,
      grid = 0.25,
      compensation = 0.02,
      level = 1,
      harmony = null,
      composer = null,
    } = {},
  ) {
    this.ctx = ctx;
    this.synth = synth;
    this.world = world;
    this.grid = grid;
    this.compensation = compensation;
    this.state = "idle"; // idle, playing, ending, finished
    this.level = level;
    this.pendingLevel = null;
    this.progression = world.progressions[progressionFor(level)];
    // Each cycle's plan, settled two bars before the cycle begins (see #planned).
    this.plans = new Map();
    this.cycleLevels = new Map(); // The energy each cycle began at, for the composer.
    // The band's composer (see composer.js), and the composed plans the band played.
    this.composer = composer;
    this.composed = [];
    // Generated harmony (see harmony.js), and the bars it will play instead of the pad.
    this.harmony = harmony;
    this.generated = new Map();
    this.cut = { requested: false, active: false, release: false };
    this.looper = new Looper(cycleBeats(world));
    this.step = 0;
    this.lead = null;
    this.voices = [];
    this.bars = new Map();
    this.endStep = null;
    this.crashNext = false;
    this.stats = { lateSteps: 0, worstLateMs: 0, notes: 0, delays: [] };
    this.listeners = new Set();
    // Every sounded note, in beats as heard, for export: { part, pitch, start, beats, velocity }.
    this.log = [];
  }

  /** Log the notes of one event starting at audio time `time`; returns the entries. */
  #logEvent(event, time) {
    const start = this.transport.beatAt(time);
    const pitches =
      event.pitches ??
      (event.pitch !== undefined ? [event.pitch] : [DRUM_NOTES[event.part]]);
    const entries = pitches
      .filter((pitch) => pitch !== undefined)
      .map((pitch) => ({
        part: event.part,
        pitch,
        start,
        beats: event.beats,
        velocity: event.velocity,
      }));
    this.log.push(...entries);
    return entries;
  }

  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #emit(event) {
    for (const listener of this.listeners) listener(event);
  }

  get beatSeconds() {
    return 60 / this.world.tempo;
  }

  start(at = this.ctx.currentTime + 0.25) {
    if (this.state !== "idle") return;
    this.transport = new Transport(this.world.tempo, at);
    this.synth.setTempo(this.transport.beatSeconds);
    this.state = "playing";
    this.timer = setInterval(() => this.#tick(), TICK_MS);
    this.#tick();
  }

  stop() {
    clearInterval(this.timer);
    const now = this.ctx.currentTime;
    this.#releaseLead(now);
    this.#choke(now);
    this.harmony?.stop();
    this.composer?.stop();
    this.state = "finished";
  }

  /** Audio time of the sample heard at performance time `seconds`. */
  contextTime(seconds) {
    const stamp = this.ctx.getOutputTimestamp?.();
    if (stamp?.performanceTime)
      return stamp.contextTime + seconds - stamp.performanceTime / 1000;
    const output = (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
    return this.ctx.currentTime - output - (performance.now() / 1000 - seconds);
  }

  /** Position on the unswung beat grid for an audio time. */
  beatAt(time) {
    return removeSwing(this.transport.beatAt(time), this.world.swing);
  }

  /** The beat being heard now, for display. */
  heardBeat() {
    if (!this.transport) return 0;
    return this.beatAt(this.contextTime(performance.now() / 1000));
  }

  barInfo(bar) {
    return this.bars.get(bar) ?? null;
  }

  // Lead hand.

  /** The gesture's moment on the heard timeline, compensated for sensor delay. */
  #gestureTime(seconds) {
    return this.contextTime(seconds) - this.compensation;
  }

  #onsetTime(seconds) {
    return alignOnset({
      transport: this.transport,
      swing: this.world.swing,
      grid: this.grid,
      eventTime: this.#gestureTime(seconds),
      now: this.ctx.currentTime,
    });
  }

  #measure(seconds, time) {
    // Capture-to-heard delay: the gesture's frame time to when its note sounds.
    const delay = (time - this.contextTime(seconds)) * 1000;
    this.stats.delays.push(delay);
    if (this.stats.delays.length > 200) this.stats.delays.shift();
    this.stats.notes++;
  }

  noteOn(rung, seconds, velocity = TYPICAL_VELOCITY) {
    if (this.state !== "playing" && this.state !== "ending") return;
    const pitch = this.world.ladder[rung];
    const time = this.#onsetTime(seconds);
    if (this.lead)
      this.synth.leadOff(
        this.lead.voice,
        Math.max(time, this.lead.start + 0.03),
        0.03,
      );
    const voice = this.synth.leadOn(time, pitch, velocity);
    this.#closeLeadLog(time);
    const [entry] = this.#logEvent(
      { part: "lead", pitch, beats: null, velocity },
      time,
    );
    this.lead = { voice, pitch, rung, start: time, entry, velocity };
    this.looper.noteOn(pitch, this.beatAt(time), velocity);
    this.#measure(seconds, time);
    const gesture = this.beatAt(this.#gestureTime(seconds));
    this.#emit({ type: "note", pitch, rung, time, gesture, velocity });
  }

  noteMove(rung, seconds) {
    if (!this.lead) return;
    const pitch = this.world.ladder[rung];
    const time = Math.max(this.#onsetTime(seconds), this.lead.start + 0.02);
    this.synth.leadMove(this.lead.voice, time, pitch);
    this.#closeLeadLog(time);
    const velocity = +(this.lead.velocity * LEGATO).toFixed(3);
    const [entry] = this.#logEvent(
      { part: "lead", pitch, beats: null, velocity },
      time,
    );
    Object.assign(this.lead, { pitch, rung, start: time, entry });
    this.looper.noteOn(pitch, this.beatAt(time), velocity);
    this.#measure(seconds, time);
    const gesture = this.beatAt(this.#gestureTime(seconds));
    this.#emit({
      type: "note",
      pitch,
      rung,
      time,
      gesture,
      legato: true,
      velocity: this.lead.velocity,
    });
  }

  /** Leaning in (up to 1) or back (down to -1) swells or softens the sounding note now. */
  swell(value) {
    if (!this.lead) return;
    this.lead.swell = value;
    this.synth.leadSwell(
      this.lead.voice,
      Math.max(this.ctx.currentTime, this.lead.start),
      value,
    );
  }

  noteOff() {
    if (!this.lead) return;
    const time = Math.max(this.ctx.currentTime + 0.005, this.lead.start + 0.06);
    this.#releaseLead(time);
  }

  #closeLeadLog(time) {
    const entry = this.lead?.entry;
    if (entry && entry.beats === null)
      entry.beats = Math.max(0.05, this.transport.beatAt(time) - entry.start);
  }

  #releaseLead(time) {
    if (!this.lead) return;
    this.#closeLeadLog(time);
    this.synth.leadOff(this.lead.voice, time);
    this.looper.noteOff(this.beatAt(time));
    this.#emit({ type: "noteOff", time });
    this.lead = null;
  }

  // Band hand.

  setEnergy(level) {
    this.pendingLevel = level === this.level ? null : level;
  }

  setCut(on) {
    if (on) Object.assign(this.cut, { requested: true, release: false });
    else if (this.cut.active)
      Object.assign(this.cut, { requested: false, release: true });
    else this.cut.requested = false;
  }

  capture() {
    if (this.state !== "playing") return null;
    const now = this.ctx.currentTime;
    if (this.lead) this.looper.noteOff(this.beatAt(now));
    const beat = this.beatAt(now);
    const layer = this.looper.capture(beat);
    if (this.lead)
      this.looper.noteOn(this.lead.pitch, beat, this.lead.velocity);
    if (!layer) return null;
    // Replays due before the scheduler's horizon would otherwise be skipped.
    for (const note of this.looper.window(beat, this.step * STEP))
      if (note.layer === layer.id) this.#playLoop(note);
    this.#emit({ type: "capture", layer });
    return layer;
  }

  undoLoop() {
    return this.looper.undo();
  }

  end() {
    if (this.state !== "playing") return;
    this.state = "ending";
    this.endStep = Math.ceil(this.step / STEPS_PER_BAR) * STEPS_PER_BAR;
    const bar = this.endStep / STEPS_PER_BAR;
    // The final chord replaces a generated bar already waiting to start on that bar line.
    for (const [at, voice] of this.generated)
      if (at >= bar) {
        voice.handle.release(this.ctx.currentTime);
        this.generated.delete(at);
      }
    this.#emit({ type: "ending", bar });
  }

  // Scheduling.

  #stepTime(step) {
    return this.transport.timeAt(applySwing(step * STEP, this.world.swing));
  }

  #tick() {
    const horizon = this.ctx.currentTime + LOOKAHEAD;
    while (this.state === "playing" || this.state === "ending") {
      const time = this.#stepTime(this.step);
      if (time >= horizon) break;
      this.#schedule(this.step, time);
      this.step++;
    }
    if (this.harmony) this.#placeGenerated();
    const now = this.ctx.currentTime;
    this.voices = this.voices.filter((voice) => voice.end > now);
  }

  #schedule(step, time) {
    const late = (this.ctx.currentTime - time) * 1000;
    if (late > 0) {
      this.stats.lateSteps++;
      this.stats.worstLateMs = Math.max(this.stats.worstLateMs, late);
    }
    const bar = Math.floor(step / STEPS_PER_BAR);
    const within = step % STEPS_PER_BAR;
    if (step === this.endStep) return this.#finish(bar, time);
    if (within === 0) this.#downbeat(bar, time);
    // A cut starts on the next eighth note.
    if (this.cut.requested && !this.cut.active && within % 2 === 0) {
      this.cut.active = true;
      this.#choke(time);
      this.bars.get(bar).cutAt ??= within;
    }
    if (within === 0 && this.harmony) this.#generate(bar, time);
    if (this.cut.active) return;
    const beatSeconds = this.beatSeconds;
    const rising =
      this.pendingLevel !== null && this.pendingLevel > this.level
        ? this.pendingLevel
        : null;
    const { world } = this;
    const events = bandStep({
      world,
      bar,
      step: within,
      level: this.level,
      progression: this.progression,
      rising,
      following: chordAt(world, this.#planned(bar + 1).chords, bar + 1),
    });
    events.push(
      ...answerEvents({
        answer: this.#planned(bar).answer,
        stepInCycle: step % (world.cycleBars * STEPS_PER_BAR),
        world,
      }),
    );
    if (within === 0 && this.crashNext) {
      events.push({ part: "crash", step: 0, beats: 4, velocity: 0.55 });
      this.crashNext = false;
    }
    for (const event of events) {
      // A generated bar already plays the chord and the answering line; they still go
      // into the log.
      const generated =
        (event.part === "pad" || event.part === "answer") &&
        this.generated.get(bar);
      if (generated) {
        generated.notes.push(...this.#logEvent(event, time));
        continue;
      }
      const handle = this.synth.play(event, time, beatSeconds);
      const notes = event.part === "riser" ? [] : this.#logEvent(event, time);
      if (handle)
        this.voices.push({
          handle,
          notes,
          end: time + event.beats * beatSeconds + 0.1,
        });
    }
    for (const note of this.looper.window(step * STEP, (step + 1) * STEP))
      this.#playLoop(note);
  }

  #downbeat(bar, time) {
    const { world } = this;
    let crash = false;
    if (this.cut.active && this.cut.release) {
      Object.assign(this.cut, { active: false, release: false });
      crash = true;
    }
    if (this.pendingLevel !== null) {
      crash ||= this.pendingLevel > this.level && this.pendingLevel >= 2;
      this.level = this.pendingLevel;
      this.pendingLevel = null;
    }
    const cycle = Math.floor(bar / world.cycleBars);
    const plan = this.#planned(bar);
    if (bar % world.cycleBars === 0) {
      this.progression = plan.chords;
      this.cycleLevels.set(cycle, this.level);
      this.cycleLevels.delete(cycle - 4);
      // While this cycle plays, the composer writes the next one.
      this.composer?.request(cycle + 1, this.#context(cycle));
      if (plan.composed) {
        const { names, texture, answer, caption, ms, model } = plan;
        this.composed.push({
          cycle,
          chords: names,
          texture,
          answer,
          caption,
          ms,
          model,
        });
        this.#emit({ type: "composed", cycle, plan, time });
      }
    }
    // The next cycle's plan is settled two bars ahead, which gives generated harmony
    // time to render it; it is settled whether or not anything renders it.
    this.#planned(bar + 2);
    this.plans.delete(cycle - 2);
    this.crashNext = crash;
    this.bars.set(bar, {
      level: this.level,
      progression: this.progression,
      chord: chordAt(world, this.progression, bar),
      next: chordAt(world, this.#planned(bar + 1).chords, bar + 1),
      composed: plan.composed,
      cut: this.cut.active,
      cutAt: this.cut.active ? 0 : null,
    });
    this.bars.delete(bar - 16);
  }

  /**
   * The plan of the cycle containing `bar`, settled the first time it is needed, two bars
   * before the cycle begins: the composer's plan if it has arrived by then, or else the
   * built-in progression for the energy at that moment.
   */
  #planned(bar) {
    const { world } = this;
    const cycle = Math.floor(bar / world.cycleBars);
    if (!this.plans.has(cycle)) {
      const written = this.composer?.take(cycle);
      const chords = world.progressions[progressionFor(this.level)];
      this.plans.set(
        cycle,
        written
          ? { ...written, composed: true }
          : {
              chords,
              names: chords.map((chord) => chord.name),
              texture: "hold",
              answer: [],
              caption: "",
              composed: false,
            },
      );
    }
    return this.plans.get(cycle);
  }

  /**
   * What the composer hears at the start of `cycle`: the energy, the chords, and the
   * player's notes in the cycle before, in sixteenths from its start.
   */
  #context(cycle) {
    const { world } = this;
    const beats = world.cycleBars * world.beatsPerBar;
    const from = (cycle - 1) * beats;
    const phrase = this.log
      .filter(
        (note) =>
          note.part === "lead" &&
          note.start >= from &&
          note.start < from + beats,
      )
      .map((note) => ({
        rung: world.ladder.indexOf(note.pitch),
        at: Math.round((note.start - from) * 4),
        len: Math.min(
          beats * 4,
          Math.max(
            1,
            Math.round((note.beats ?? from + beats - note.start) * 4),
          ),
        ),
      }))
      .filter((note) => note.rung >= 0 && note.at < beats * 4)
      .slice(-64);
    const earlier = [cycle - 2, cycle - 1]
      .filter((c) => this.cycleLevels.has(c))
      .map((c) => this.cycleLevels.get(c));
    const current = this.#planned(cycle * world.cycleBars);
    const before = cycle > 0 ? this.plans.get(cycle - 1) : null;
    return {
      level: this.pendingLevel ?? this.level,
      earlier_levels: earlier,
      current: current.names,
      history: before ? before.names : [],
      phrase,
      previous_answer: current.answer,
    };
  }

  /**
   * What generated harmony renders for `bar`: the plan's chord in its texture, and the
   * part of the answering line that falls in this bar.
   */
  #harmonyBar(bar) {
    const { world } = this;
    const plan = this.#planned(bar);
    const chord = chordAt(world, plan.chords, bar);
    const before = bar > 0 ? this.#planned(bar - 1) : null;
    const previous = before && {
      chord: chordAt(world, before.chords, bar - 1),
      texture: before.texture,
    };
    return {
      chord: chord.name,
      tones: chord.tones,
      notes: [
        ...harmonyNotes({ chord, texture: plan.texture, previous, world }),
        ...answerNotes({
          answer: plan.answer,
          barInCycle: bar % world.cycleBars,
          world,
        }),
      ],
    };
  }

  // Generated harmony. At each bar line: follow the energy, count what the bar played,
  // and ask for the chords of the next two bars (each is rendered once).
  #generate(bar, time) {
    const { harmony, world } = this;
    for (const at of this.generated.keys())
      if (at < bar) this.generated.delete(at);
    harmony.setLevel(this.level, time);
    if (!this.cut.active) harmony.passed(bar, this.generated.has(bar));
    for (const ahead of [bar + 1, bar + 2])
      harmony.request(ahead, this.#harmonyBar(ahead));
  }

  // A generated bar starts as soon as its audio arrives, while there is still time for
  // it to start cleanly before its bar line. A bar that misses keeps the synthesized pad.
  #placeGenerated() {
    const { harmony } = this;
    const cutting =
      this.cut.requested || (this.cut.active && !this.cut.release);
    if (this.state !== "playing" || cutting) return;
    const now = this.ctx.currentTime;
    const first = Math.ceil(this.step / STEPS_PER_BAR);
    for (const bar of [first, first + 1, first + 2]) {
      if (this.generated.has(bar) || !harmony.ready(bar)) continue;
      const time = this.#stepTime(bar * STEPS_PER_BAR);
      if (time - harmony.lead - now < PLACE_MARGIN) continue;
      const handle = harmony.play(bar, time);
      if (!handle) continue;
      const voice = {
        handle,
        notes: [],
        end: time + this.world.beatsPerBar * this.beatSeconds + 1,
      };
      this.voices.push(voice);
      this.generated.set(bar, voice);
    }
  }

  #playLoop(note) {
    const time = this.transport.timeAt(applySwing(note.beat, this.world.swing));
    if (time < this.ctx.currentTime) return;
    const seconds = note.beats * this.beatSeconds;
    const index = this.looper.layers.findIndex(
      (layer) => layer.id === note.layer,
    );
    const pan = LOOP_PANS[Math.max(0, index) % LOOP_PANS.length];
    const handle = this.synth.pluck(
      time,
      note.velocity * 0.9,
      note.pitch,
      seconds,
      pan,
    );
    const notes = this.#logEvent(
      {
        part: "loop",
        pitch: note.pitch,
        beats: note.beats,
        velocity: note.velocity * 0.9,
      },
      time,
    );
    this.voices.push({ handle, notes, end: time + seconds + 0.8 });
    this.#emit({
      type: "loopNote",
      layer: note.layer,
      pitch: note.pitch,
      time,
    });
  }

  #choke(time) {
    const beat = this.transport.beatAt(time);
    for (const voice of this.voices) {
      voice.handle.release(time);
      for (const note of voice.notes ?? [])
        note.beats = Math.max(0.05, Math.min(note.beats, beat - note.start));
    }
    this.voices = [];
    // Generated bars were among the voices. Bars whose audio is still waiting in
    // harmony.js can start once the band plays again.
    this.generated.clear();
  }

  #finish(bar, time) {
    this.#choke(time);
    this.#releaseLead(time);
    this.harmony?.stop();
    this.composer?.stop();
    const beatSeconds = this.beatSeconds;
    const tail = time + 2 * this.world.beatsPerBar * beatSeconds + 1.5;
    for (const event of bandEnding(this.world)) {
      const handle = this.synth.play(event, time, beatSeconds);
      const notes = this.#logEvent(event, time);
      if (handle) this.voices.push({ handle, notes, end: tail });
    }
    this.bars.set(bar, {
      level: this.level,
      progression: this.progression,
      chord: this.world.tonic,
      next: null,
      cut: false,
      cutAt: null,
      final: true,
    });
    this.state = "finished";
    clearInterval(this.timer);
    this.finishedAt = tail;
    this.#emit({ type: "finished", time, tail });
  }
}
