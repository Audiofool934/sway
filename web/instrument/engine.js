// The performance engine: a lookahead scheduler on the AudioContext clock that turns
// control events into band, loop, and lead sounds. Control times arrive in
// performance.now() seconds and are mapped to the audio timeline as heard.

import { STEPS_PER_BAR, bandEnding, bandStep, progressionFor } from "./band.js";
import { Transport, alignOnset, applySwing, removeSwing } from "./clock.js";
import { Looper } from "./looper.js";
import { DRUM_NOTES } from "./midi.js";
import { WORLD, chordAt, cycleBeats } from "./theory.js";

const LOOKAHEAD = 0.12;
const TICK_MS = 20;
// The least time before a generated bar starts for it to be placed.
const PLACE_MARGIN = 0.05;
const STEP = 0.25;
const LOOP_PANS = [-0.35, 0.35, -0.15, 0.15];

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
    this.progression = progressionFor(level);
    // Each cycle's progression, settled two bars before the cycle begins.
    this.plans = new Map();
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

  noteOn(rung, seconds) {
    if (this.state !== "playing" && this.state !== "ending") return;
    const pitch = this.world.ladder[rung];
    const time = this.#onsetTime(seconds);
    if (this.lead)
      this.synth.leadOff(
        this.lead.voice,
        Math.max(time, this.lead.start + 0.03),
        0.03,
      );
    const voice = this.synth.leadOn(time, pitch, 0.85);
    this.#closeLeadLog(time);
    const [entry] = this.#logEvent(
      { part: "lead", pitch, beats: null, velocity: 0.85 },
      time,
    );
    this.lead = { voice, pitch, rung, start: time, entry };
    this.looper.noteOn(pitch, this.beatAt(time));
    this.#measure(seconds, time);
    const gesture = this.beatAt(this.#gestureTime(seconds));
    this.#emit({ type: "note", pitch, rung, time, gesture });
  }

  noteMove(rung, seconds) {
    if (!this.lead) return;
    const pitch = this.world.ladder[rung];
    const time = Math.max(this.#onsetTime(seconds), this.lead.start + 0.02);
    this.synth.leadMove(this.lead.voice, time, pitch);
    this.#closeLeadLog(time);
    const [entry] = this.#logEvent(
      { part: "lead", pitch, beats: null, velocity: 0.7 },
      time,
    );
    Object.assign(this.lead, { pitch, rung, start: time, entry });
    this.looper.noteOn(pitch, this.beatAt(time));
    this.#measure(seconds, time);
    const gesture = this.beatAt(this.#gestureTime(seconds));
    this.#emit({ type: "note", pitch, rung, time, gesture, legato: true });
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
    if (this.lead) this.looper.noteOn(this.lead.pitch, beat);
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
    if (within === 0) this.#downbeat(bar);
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
    const events = bandStep({
      world: this.world,
      bar,
      step: within,
      level: this.level,
      progression: this.progression,
      rising,
    });
    if (within === 0 && this.crashNext) {
      events.push({ part: "crash", step: 0, beats: 4, velocity: 0.55 });
      this.crashNext = false;
    }
    for (const event of events) {
      // A generated bar already plays this chord; the pad still goes into the log.
      const generated = event.part === "pad" && this.generated.get(bar);
      if (generated) {
        generated.notes = this.#logEvent(event, time);
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

  #downbeat(bar) {
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
    const cycle = Math.floor(bar / this.world.cycleBars);
    if (bar % this.world.cycleBars === 0) this.progression = this.#planned(bar);
    // The next progression is settled two bars ahead, which gives generated harmony
    // time to render it; it is settled whether or not anything renders it.
    this.#planned(bar + 2);
    this.plans.delete(cycle - 1);
    this.crashNext = crash;
    this.bars.set(bar, {
      level: this.level,
      progression: this.progression,
      chord: chordAt(this.world, this.progression, bar),
      next: chordAt(this.world, this.#planned(bar + 1), bar + 1),
      cut: this.cut.active,
      cutAt: this.cut.active ? 0 : null,
    });
    this.bars.delete(bar - 16);
  }

  /** The progression of the cycle containing `bar`, settled at the energy level then. */
  #planned(bar) {
    const cycle = Math.floor(bar / this.world.cycleBars);
    if (!this.plans.has(cycle))
      this.plans.set(cycle, progressionFor(this.level));
    return this.plans.get(cycle);
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
      harmony.request(ahead, chordAt(world, this.#planned(ahead), ahead));
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
