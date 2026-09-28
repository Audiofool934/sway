// The band's part, one sixteenth step at a time, from energy level and harmony.
// Patterns are fixed per level so the band behaves predictably; small seeded
// variations keep repetition from sounding mechanical.

import { chordAt } from "./theory.js";

export const STEPS_PER_BAR = 16;
const STEP = 0.25; // Beats per sixteenth.

const grid = (pattern) => (pattern ? [...pattern].map((c) => c === "x") : null);

// Index = energy level: 0 air, 1 pulse, 2 groove, 3 drive, 4 peak.
const DRUMS = {
  kick: [
    null,
    "x.......x.......",
    "x.....x...x.....",
    "x.....x.x.x...x.",
    "x.....x.x.x...x.",
  ],
  snare: [
    null,
    null,
    "....x.......x...",
    "....x.......x...",
    "....x.......x...",
  ],
  clap: [null, null, null, null, "....x.......x..."],
  hat: [null, null, "x.x.x.x.x.x.x.x.", "xxxxxxxxxxxxxx.x", "xx.xxx.xxx.xxx.x"],
  openhat: [null, null, null, "..............x.", "..x...x...x...x."],
  shaker: [null, "xxxxxxxxxxxxxxxx", "..x...x...x...x.", null, null],
};
const PATTERNS = Object.fromEntries(
  Object.entries(DRUMS).map(([part, levels]) => [part, levels.map(grid)]),
);

// [step, note, beats]: R root, O octave, F fifth, N next chord's root (an approach).
const BASS = [
  [],
  [[0, "R", 4]],
  [
    [0, "R", 1.5],
    [6, "R", 0.5],
    [10, "R", 1],
    [14, "O", 0.4],
  ],
  [
    [0, "R", 0.75],
    [3, "R", 0.25],
    [6, "R", 0.5],
    [8, "O", 0.5],
    [10, "R", 0.5],
    [12, "F", 0.5],
    [14, "N", 0.5],
  ],
  [0, 2, 4, 6, 8, 10, 12, 14].map((step, i) => [
    step,
    step === 14 ? "N" : i % 2 ? "O" : "R",
    0.4,
  ]),
];

// [step, beats] for electric-piano comping.
const KEYS = [
  [],
  [],
  [
    [0, 1],
    [7, 0.5],
    [10, 1.25],
  ],
  [
    [0, 0.5],
    [3, 0.5],
    [6, 0.5],
    [10, 0.5],
    [13, 0.75],
  ],
  [
    [0, 0.4],
    [2, 0.4],
    [6, 0.4],
    [10, 0.4],
    [14, 0.4],
  ],
];

// Pad loudness and brightness per level; the pad carries the air level on its own.
export const PAD = {
  gain: [0.9, 0.8, 0.55, 0.5, 0.6],
  brightness: [0.2, 0.3, 0.4, 0.55, 0.8],
};

const ARP_ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1, 2, 3];

// Deterministic hash in [0, 1), so a bar always varies the same way.
export function hash(n, salt = 0) {
  let x =
    Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35);
  x ^= x >>> 13;
  x = Math.imul(x, 0x27d4eb2f);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export const progressionFor = (level) => (level >= 3 ? "high" : "low");

function bassPitch(symbol, chord, next) {
  if (symbol === "O") return chord.bass + 12;
  if (symbol === "F") return chord.bass + 7;
  if (symbol === "N") return next.bass;
  return chord.bass;
}

/**
 * Band events for one sixteenth step. `bar` counts from the start of the piece.
 * `rising` is the level about to land on the next downbeat, when it is higher.
 * Each event: { part, step, beats, velocity, pitch | pitches }.
 */
export function bandStep({
  world,
  bar,
  step,
  level,
  progression,
  rising = null,
}) {
  const events = [];
  const chord = chordAt(world, progression, bar);
  const next = chordAt(world, progression, bar + 1);
  const seed = bar * STEPS_PER_BAR + step;
  const humanize = (velocity, salt) =>
    velocity * (0.9 + 0.2 * hash(seed, salt));
  const add = (part, velocity, extra = {}) =>
    events.push({ part, step, beats: STEP, velocity, ...extra });

  const lastBeat = step >= 12;
  const fill = rising !== null && rising >= 2 && level >= 1 && lastBeat;
  const phraseEnd = bar % world.cycleBars === world.cycleBars - 1;
  const phraseFill =
    !fill && phraseEnd && level >= 2 && step >= 14 && hash(bar, 7) < 0.6;

  // Drums.
  if (PATTERNS.kick[level]?.[step] || (fill && step === 12))
    add("kick", humanize(step % 4 === 0 ? 0.95 : 0.75, 1));
  if (fill) add("snare", 0.3 + 0.18 * (step - 12));
  else if (phraseFill) add("snare", step === 14 ? 0.35 : 0.5);
  else if (PATTERNS.snare[level]?.[step]) add("snare", humanize(0.85, 2));
  else if (level >= 3 && (step === 7 || step === 15) && hash(seed, 3) < 0.3)
    add("snare", 0.22); // Ghost note.
  if (PATTERNS.clap[level]?.[step]) add("clap", humanize(0.6, 4));
  const hatsOpen = !fill && !(phraseFill && step === 15);
  if (hatsOpen && PATTERNS.hat[level]?.[step]) {
    const accent = step % 4 === 0 ? 0.75 : step % 2 === 0 ? 0.55 : 0.38;
    add("hat", humanize(accent, 5));
  }
  if (hatsOpen && PATTERNS.openhat[level]?.[step])
    add("openhat", humanize(0.5, 6));
  if (PATTERNS.shaker[level]?.[step])
    add("shaker", humanize(step % 2 === 0 ? 0.45 : 0.3, 8));
  if (rising !== null && level <= 1 && step === 8)
    add("riser", 0.7, { beats: 2 });

  // Bass.
  for (const [at, symbol, beats] of BASS[level])
    if (at === step)
      add("bass", humanize(at % 4 === 0 ? 0.9 : 0.75, 9), {
        beats,
        pitch: bassPitch(symbol, chord, next),
      });

  // Harmony.
  if (step === 0)
    add("pad", PAD.gain[level], {
      beats: world.beatsPerBar,
      pitches: chord.pad,
      brightness: PAD.brightness[level],
    });
  for (const [at, beats] of KEYS[level])
    if (at === step)
      add("keys", humanize(at === 0 ? 0.7 : 0.55, 10), {
        beats,
        pitches: chord.pad,
      });
  if (level === 4) {
    const notes = [...chord.pad, ...chord.pad.map((p) => p + 12)];
    add("arp", humanize(step % 4 === 0 ? 0.55 : 0.4, 11), {
      beats: 0.2,
      pitch: notes[ARP_ORDER[step] % notes.length],
    });
  }
  return events;
}

/** The final chord: everything resolves to the tonic on one downbeat and rings. */
export function bandEnding(world) {
  const chord = world.tonic;
  const beats = world.beatsPerBar * 2;
  return [
    { part: "kick", step: 0, beats: STEP, velocity: 0.9 },
    { part: "crash", step: 0, beats, velocity: 0.7 },
    { part: "bass", step: 0, beats, velocity: 0.85, pitch: chord.bass },
    {
      part: "pad",
      step: 0,
      beats,
      velocity: 0.8,
      pitches: chord.pad,
      brightness: 0.5,
    },
    { part: "keys", step: 0, beats, velocity: 0.7, pitches: chord.pad },
  ];
}
