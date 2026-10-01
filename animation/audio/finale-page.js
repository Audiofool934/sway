// The finale's soundtrack, rendered in a browser page by Sway's own synthesizer and band.
// This page replays the scheduling logic of web/instrument/engine.js offline: the same band
// patterns (band.js), the same synth voices (synth.js), the same swing, energy changes that
// land on downbeats, loop capture, and the choke-and-resolve ending, driven by the film's
// performance script (src/score.js playScript) instead of a camera.

import {
  bandEnding,
  bandStep,
  progressionFor,
  STEPS_PER_BAR,
} from "/web/instrument/band.js";
import { applySwing } from "/web/instrument/clock.js";
import { Looper } from "/web/instrument/looper.js";
import { Synth } from "/web/instrument/synth.js";
import { WORLD, chordAt } from "/web/instrument/theory.js";
import { playScript } from "/animation/src/score.js";
import { BEAT, SR, atBar } from "/animation/src/timeline.js";

const STEP = 0.25;
const LOOP_PANS = [-0.35, 0.35, -0.15, 0.15];

/** A seeded Math.random, so the synth's noise and reverb are identical on every render. */
function seedRandom(seed) {
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function toBase64(typed) {
  const blob = new Blob([
    typed.buffer.slice(typed.byteOffset, typed.byteOffset + typed.byteLength),
  ]);
  return await new Promise((done) => {
    const reader = new FileReader();
    reader.onload = () => done(String(reader.result).split(",")[1]);
    reader.readAsDataURL(blob);
  });
}

window.renderFinale = async function renderFinale({ tail = 12 } = {}) {
  seedRandom(2026);
  const script = playScript();
  const world = WORLD;
  const firstBar = 72;
  const endBar = script.endBar;
  const t0 = atBar(firstBar);
  const seconds = atBar(endBar) - t0 + tail;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR);
  const synth = new Synth(ctx, { beatSeconds: BEAT });
  synth.setTempo(BEAT);

  // Film beats to seconds in this context, with Sway's swing on the sixteenths.
  const at = (beat) => applySwing(beat, world.swing) * BEAT - t0;

  const askedBeat = (l) => (l.asked ? l.asked[0] * 4 + l.asked[1] : l.bar * 4);
  const levelByBar = (bar) =>
    script.levels.reduce((level, l) => (bar >= l.bar ? l.level : level), 0);
  // The cycle's chords are settled two bars before it starts, from the energy then.
  const cycleChords = (cycle) =>
    world.progressions[progressionFor(levelByBar(cycle * world.cycleBars - 2))];

  const looper = new Looper(world.cycleBars * world.beatsPerBar);
  const voices = [];
  let lead = null;
  let level = levelByBar(firstBar);
  let pending = null;
  let crashNext = false;
  let layerCount = 0;
  const requested = new Set();

  const gestures = [...script.lead].sort((a, b) => a.beat - b.beat);
  let nextGesture = 0;
  let captured = false;
  const captureBeat = script.capture.bar * 4 + script.capture.beat;

  const doGesture = (g) => {
    const time = at(g.beat);
    if (g.type === "on") {
      if (lead)
        synth.leadOff(lead.voice, Math.max(time, lead.start + 0.03), 0.03);
      const voice = synth.leadOn(time, g.midi, 0.85);
      looper.noteOn(g.midi, g.beat);
      lead = { voice, start: time, midi: g.midi };
    } else if (g.type === "move" && lead) {
      synth.leadMove(lead.voice, Math.max(time, lead.start + 0.02), g.midi);
      looper.noteOn(g.midi, g.beat);
      lead.start = time;
      lead.midi = g.midi;
    } else if (g.type === "off" && lead) {
      synth.leadOff(lead.voice, Math.max(time, lead.start + 0.06));
      looper.noteOff(g.beat);
      lead = null;
    }
  };

  const playLoop = (note) => {
    const index = Math.max(
      0,
      looper.layers.findIndex((l) => l.id === note.layer),
    );
    const time = at(note.beat);
    const seconds = note.beats * BEAT;
    const handle = synth.pluck(
      time,
      note.velocity * 0.9,
      note.pitch,
      seconds,
      LOOP_PANS[index % LOOP_PANS.length],
    );
    voices.push({ handle, end: time + seconds + 0.8 });
  };

  for (let bar = firstBar; bar < endBar; bar++) {
    for (let step = 0; step < STEPS_PER_BAR; step++) {
      const beat = bar * 4 + step * STEP;
      const time = at(beat);

      // Gestures that have happened by now: energy requests, the lead hand, the capture.
      for (const l of script.levels)
        if (l.bar > firstBar && !requested.has(l.bar) && beat >= askedBeat(l)) {
          requested.add(l.bar);
          pending = l.level === level ? null : l.level;
        }
      while (
        nextGesture < gestures.length &&
        gestures[nextGesture].beat <= beat + 1e-9
      )
        doGesture(gestures[nextGesture++]);
      if (!captured && beat >= captureBeat - 1e-9) {
        captured = true;
        if (lead) looper.noteOff(captureBeat);
        const layer = looper.capture(captureBeat);
        if (lead) looper.noteOn(lead.midi, captureBeat);
        if (layer) {
          layerCount++;
          // Replays due before the scheduler's horizon would otherwise be skipped.
          for (const note of looper.window(captureBeat, beat))
            if (note.layer === layer.id) playLoop(note);
        }
      }

      if (step === 0) {
        let crash = false;
        if (pending !== null) {
          crash ||= pending > level && pending >= 2;
          level = pending;
          pending = null;
        }
        crashNext = crash;
      }
      const rising = pending !== null && pending > level ? pending : null;
      const events = bandStep({
        world,
        bar,
        step,
        level,
        progression: cycleChords(Math.floor(bar / world.cycleBars)),
        rising,
        following: chordAt(
          world,
          cycleChords(Math.floor((bar + 1) / world.cycleBars)),
          bar + 1,
        ),
      });
      if (step === 0 && crashNext) {
        events.push({ part: "crash", step: 0, beats: 4, velocity: 0.55 });
        crashNext = false;
      }
      for (const event of events) {
        const handle = synth.play(event, time, BEAT);
        if (handle)
          voices.push({ handle, end: time + event.beats * BEAT + 0.1 });
      }
      for (const note of looper.window(beat, beat + STEP)) playLoop(note);
    }
  }

  // The ending: everything is choked on the bar line, then the tonic rings.
  const tEnd = at(endBar * 4);
  for (const v of voices) if (v.end > tEnd) v.handle.release(tEnd);
  if (lead) synth.leadOff(lead.voice, tEnd);
  for (const event of bandEnding(world)) synth.play(event, tEnd, BEAT);

  const buffer = await ctx.startRendering();
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const interleaved = new Float32Array(left.length * 2);
  for (let i = 0; i < left.length; i++) {
    interleaved[2 * i] = left[i];
    interleaved[2 * i + 1] = right[i];
  }
  return {
    start: t0,
    frames: left.length,
    layers: layerCount,
    base64: await toBase64(interleaved),
  };
};

window.finaleReady = true;
