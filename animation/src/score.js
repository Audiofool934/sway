// The film's single tune, and the cue sheets the picture and soundtrack share.
//
// One melody travels through every chapter, re-made in each era's material: string,
// ink, pins, grooves, sine waves, voltage, samples, messages, tracks. It is written on
// Sway's own ladder (A minor pentatonic, A3 to G5) over Sway's own four chords, so the
// finale, played by Sway's real band, is the same tune in its newest material.

import { CHORDS, WORLD } from "../../web/instrument/theory.js";
import { BAR, BEAT, atBar, byId } from "./timeline.js";

export const LADDER = WORLD.ladder; // [57, 60, 62, 64, 67, 69, 72, 74, 76, 79]
export const PROGRESSION = ["Am", "F", "C", "G"]; // Sway's low-energy cycle.

/** The chord sounding in film bar `bar`; the cycle begins on Am at bar 0. */
export const chordOfBar = (bar) => CHORDS[PROGRESSION[((bar % 4) + 4) % 4]];

// The motif: four bars (one chord cycle), as [beat, MIDI pitch, beats held].
// Rising A C E, falling D C A; a longer climb G A C E; the same fall, home to A.
export const MOTIF = [
  [0, 69, 1], // A4
  [1, 72, 1], // C5
  [2, 76, 2], // E5
  [4, 74, 1.5], // D5
  [5.5, 72, 0.5], // C5
  [6, 69, 2], // A4
  [8, 67, 1], // G4
  [9, 69, 1], // A4
  [10, 72, 1], // C5
  [11, 76, 1], // E5
  [12, 74, 1.5], // D5
  [13.5, 72, 0.5], // C5
  [14, 69, 2], // A4
];

/**
 * The motif starting at film bar `bar`. `scale` stretches time (free-time chapters play
 * it slower), `transpose` shifts it in semitones. Times are film seconds.
 */
export function motif(bar, { scale = 1, transpose = 0, from = 0, to = 16 } = {}) {
  return MOTIF.map(([beat, pitch, beats], index) => ({
    index,
    beat,
    midi: pitch + transpose,
    t: atBar(bar) + beat * BEAT * scale,
    dur: beats * BEAT * scale,
  })).filter((note) => note.beat >= from && note.beat < to);
}

/** The pitch class a note is sung on in Guido's hexachord on C: ut re mi fa sol la. */
export const SOLFEGE = { 0: "Ut", 2: "Re", 4: "Mi", 5: "Fa", 7: "Sol", 9: "La" };

const at = (id, seconds) => byId[id].start + seconds;
const freq = (midi) => 440 * 2 ** ((midi - 69) / 12);
export { freq };

// Cue sheets. Times are film seconds; the scenes subtract their chapter's start.
export const cues = {
  // A string, then the monochord: a bridge at 1/2, 2/3, 3/4 of the string gives the
  // octave, fifth, and fourth, in pure ratios of an open A2 (110 Hz).
  vibrate: {
    open: 110,
    pluck: at("vibrate", 1.2),
    title: [at("vibrate", 1.8), at("vibrate", 6.6)],
    monochord: at("vibrate", 6.0),
    intervals: [
      { name: "octave", ratio: [2, 1], length: 1 / 2, slide: at("vibrate", 7.2), pluck: at("vibrate", 7.8) },
      { name: "fifth", ratio: [3, 2], length: 2 / 3, slide: at("vibrate", 9.6), pluck: at("vibrate", 10.2) },
      { name: "fourth", ratio: [4, 3], length: 3 / 4, slide: at("vibrate", 12.0), pluck: at("vibrate", 12.6) },
    ],
    // The open string's own overtones: harmonics 1, 2, 3, 4, 6 of A2.
    harmonics: [1, 2, 3, 4, 6].map((n, i) => ({ n, t: at("vibrate", 14.4 + i * 0.6) })),
  },

  // Theremin for four bars, then the organ: its nine drawbars are pulled out one at a time
  // (index into the 16', 5 1/3', 8', 4', 2 2/3', 2', 1 3/5', 1 1/3', 1' footages), so the
  // chord grows from one sine wave to nine.
  electrify: {
    theremin: at("electrify", 0),
    organ: at("electrify", 9.6),
    // Each pull lands on a half-bar chord (every 1.2 s); the last two sliders come out together.
    drawbars: [
      { i: 2, level: 8, slot: 0 },
      { i: 3, level: 6, slot: 1 },
      { i: 5, level: 5, slot: 2 },
      { i: 0, level: 5, slot: 3 },
      { i: 4, level: 4, slot: 4 },
      { i: 1, level: 3, slot: 5 },
      { i: 8, level: 4, slot: 6 },
      { i: 7, level: 3, slot: 7 },
      { i: 6, level: 2, slot: 7 },
    ].map((pull) => ({ ...pull, t: at("electrify", 9.6 + pull.slot * 1.2) })),
  },

  // Count: a smooth wave is sampled, and the sampling gets finer in steps. The sound is
  // degraded to match (sample-and-hold, no anti-alias filter) and resolves as the picture does.
  count: {
    sampling: at("count", 2.4),
    steps: [
      { t: at("count", 2.4), rate: 4000, bits: 4 },
      { t: at("count", 4.0), rate: 6000, bits: 5 },
      { t: at("count", 5.6), rate: 12000, bits: 6 },
      { t: at("count", 7.2), rate: 22050, bits: 8 },
      { t: at("count", 8.4), rate: 32000, bits: 12 },
      { t: at("count", 9.6), rate: 44100, bits: 16 },
    ],
    // A rising sine sampled too slowly folds back down: the aliasing demonstration.
    alias: { t: at("count", 6.0), dur: 1.4 },
    spectrum: at("count", 12.0),
  },

  // Connect: a 16-step drum machine builds up bar by bar, then a sampler chops a recording.
  // Each row is 16 sixteenth-note steps; "x" is a hit.
  connect: {
    rows: {
      kick: { pattern: "x..x..x...x.....", from: 48 },
      snare: { pattern: "....x.......x...", from: 49 },
      hat: { pattern: "x.x.x.x.x.x.x.x.", from: 50 },
      open: { pattern: "..............x.", from: 51 },
      cow: { pattern: "...x.......x...x", from: 51 },
      chop: { pattern: "..x..x...x...x..", from: 52 },
    },
    // Bars that end with a snare roll into the next one.
    fills: [51, 55],
    midi: { from: at("connect", 9.6), to: at("connect", 14.4) },
  },

  // Assemble: when each layer of the finished track enters (film bars), and the stop.
  assemble: {
    layers: [
      { id: "drums", bar: 56 },
      { id: "bass", bar: 56 },
      { id: "melody", bar: 56 },
      { id: "pad", bar: 57 },
      { id: "chops", bar: 58 },
      { id: "arp", bar: 59 },
      { id: "claps", bar: 60 },
      { id: "bells", bar: 60 },
    ],
    riser: at("assemble", 14.4),
    stop: byId.assemble.end,
  },

  // Delegate: loops of different lengths (in beats) that drift in and out of phase, each
  // holding a few pentatonic notes [beat, MIDI]; the combination never quite repeats.
  delegate: {
    start: at("delegate", 2.4),
    loops: [
      { id: "box", beats: 7, notes: [[0, 81], [2, 76], [4.5, 72]] },
      { id: "bell", beats: 11, notes: [[1, 74], [5, 67], [8, 69]] },
      { id: "low", beats: 17, notes: [[0, 57], [9, 52]] },
      { id: "spark", beats: 13, notes: [[0, 79], [6, 74], [10, 76]], enters: at("delegate", 9.6) },
    ],
  },

  // Play: Sway's own band, performed by scripted gestures. Bars are film bars. Energy
  // levels land on downbeats (a request is made a little before); the lead hand plays the
  // tune in three statements (one pinch per bar, moving between rungs while held); the
  // band hand captures a loop at bar 85, and two fists end the piece for the bar line at 88.
  play: {
    levels: [
      { bar: 72, level: 0 },
      { bar: 74, level: 1, asked: [73, 1.5] },
      { bar: 76, level: 2, asked: [75, 1.5] },
      { bar: 80, level: 3, asked: [79, 1.5] },
      { bar: 84, level: 4, asked: [83, 1.5] },
    ],
    statements: [76, 80, 84],
    capture: { bar: 85, beat: 0, held: 0.6 },
    fists: { bar: 87, beat: 2.3, held: 0.9 },
    endBar: 88,
  },

  // Chant: the motif in free time, a little slower than the grid, in parallel fifths.
  write: {
    start: at("write", 1.8),
    beat: BEAT * 1.125,
    notes: MOTIF.map(([beat, pitch, beats], index) => ({
      index,
      midi: pitch,
      t: at("write", 1.8) + beat * BEAT * 1.125,
      dur: beats * BEAT * 1.125,
      syllable: SOLFEGE[pitch % 12],
    })),
  },
};

export { BAR, BEAT, atBar };
