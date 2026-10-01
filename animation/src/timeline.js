// The film's shared clock. The picture and the soundtrack both read this file, so a
// chapter starts on the same bar line in both. Tempo and key are Sway's own world
// (see web/instrument/theory.js): A minor at 100 BPM.

export const W = 1920;
export const H = 1080;
export const FPS = 30;
export const SR = 48000;

export const BPM = 100;
export const BEAT = 60 / BPM; // 0.6 s
export const BAR = BEAT * 4; // 2.4 s

// Eleven chapters, one verb each, then an end card. `bars` is the length on the
// bar grid; `year` is the small stamp, `head` and `body` the caption.
const CHAPTERS = [
  {
    id: "vibrate",
    verb: "Vibrate",
    bars: 8,
    year: "c. 500 BCE · ancient Greece",
    head: "Pitch is a ratio.",
    body: "Halve a string and the note jumps an octave. Tradition credits Pythagoras: music begins as arithmetic.",
  },
  {
    id: "write",
    verb: "Write",
    bars: 6,
    year: "c. 1025 · Guido of Arezzo and after",
    head: "Put the pitch on a line.",
    body: "A singer can learn a song they have never heard. Later teachers even mapped pitch onto the joints of a hand.",
  },
  {
    id: "repeat",
    verb: "Repeat",
    bars: 6,
    year: "9th century – 1904 · pins to paper",
    head: "A song, stored as holes.",
    body: "Pinned cylinders, music boxes, punched paper rolls: music plays without a musician, on a grid of pitch against time.",
  },
  {
    id: "record",
    verb: "Record",
    bars: 8,
    year: "1857 – 1948 · Scott, Edison, Schaeffer",
    head: "Sound leaves a trace.",
    body: "First a wobbling line, then grooves, then magnetism. Once sound is a thing you can hold, you can cut it, loop it, reverse it.",
  },
  {
    id: "electrify",
    verb: "Electrify",
    bars: 8,
    year: "1920 – 1935 · theremin, Hammond",
    head: "Electricity replaces the string.",
    body: "The theremin is played without touching it. The Hammond organ mixes nine sine waves by hand: Fourier’s idea, in a wooden box.",
  },
  {
    id: "control",
    verb: "Control",
    bars: 4,
    year: "1964 · Moog, Buchla",
    head: "Every sound becomes a knob.",
    body: "Voltage control lets any signal steer any other. One volt per octave: a melody becomes a staircase of electricity.",
  },
  {
    id: "count",
    verb: "Count",
    bars: 8,
    year: "1957 – 1982 · Max Mathews, Bell Labs",
    head: "Sound becomes numbers.",
    body: "Measure a wave often enough and nothing is lost. A sound is now a list of numbers: easy to store, analyze, and change.",
  },
  {
    id: "connect",
    verb: "Connect",
    bars: 8,
    year: "1980 – 1988 · TR-808, MIDI, MPC",
    head: "Music becomes messages.",
    body: "A grid for time, a cable that says which note and how hard, a sampler that turns any sound into a key. Playing and sounding come apart.",
  },
  {
    id: "assemble",
    verb: "Assemble",
    bars: 8,
    year: "1989 – 2004 · Cubase, Pro Tools, Live",
    head: "A studio in a laptop.",
    body: "Nothing inside is new. Every part was once a machine: string, roll, groove, knob, number. There was no gap, only layers.",
  },
  {
    id: "delegate",
    verb: "Delegate",
    bars: 8,
    year: "1957 – today · Illiac, Eno, neural models",
    head: "The machine learns the craft.",
    body: "Rules, then loops, then learned models: software can supply harmony, timing and arrangement. One thing is left for you.",
  },
  {
    id: "play",
    verb: "Play",
    bars: 16,
    year: "2026 · Sway",
    head: "What you mean.",
    body: "One hand picks notes on a ladder of pitches. The other conducts the band. The machine supplies the competence; you supply the intention.",
  },
  { id: "end", verb: "", bars: 4, year: "", head: "", body: "" },
];

let cursor = 0;
export const chapters = CHAPTERS.map((chapter, index) => {
  const start = cursor * BAR;
  cursor += chapter.bars;
  return {
    ...chapter,
    index,
    startBar: cursor - chapter.bars,
    start,
    duration: chapter.bars * BAR,
    end: cursor * BAR,
  };
});

export const TOTAL_BARS = cursor;
export const DURATION = TOTAL_BARS * BAR;
export const FRAMES = Math.round(DURATION * FPS);

export const byId = Object.fromEntries(chapters.map((c) => [c.id, c]));

/** The chapter playing at film time `time`, clamped to the first and last. */
export function chapterAt(time) {
  for (const chapter of chapters) if (time < chapter.end) return chapter;
  return chapters.at(-1);
}

/** Film seconds at a bar (counted from 0) and beat within it. */
export const atBar = (bar, beat = 0) => (bar * 4 + beat) * BEAT;
