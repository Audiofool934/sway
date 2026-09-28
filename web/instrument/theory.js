// Pitches are MIDI note numbers; musical time is counted in quarter-note beats.

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const noteName = (pitch) => NAMES[pitch % 12];
export const frequency = (pitch) => 440 * 2 ** ((pitch - 69) / 12);
export const clamp = (value, low = 0, high = 1) =>
  Math.min(high, Math.max(low, value));

// Voicings are written out so every chord change keeps common tones in place.
const CHORDS = {
  Am: { name: "Am", tones: [9, 0, 4], bass: 33, pad: [57, 60, 64, 67] },
  F: { name: "F", tones: [5, 9, 0], bass: 41, pad: [53, 57, 60, 64] },
  C: { name: "C", tones: [0, 4, 7], bass: 36, pad: [55, 60, 64, 67] },
  // No third: B would rub against the ladder's C, so G is voiced open.
  G: { name: "G", tones: [7, 2], bass: 43, pad: [55, 62, 64, 69] },
};

export const WORLD = {
  id: "night-drive",
  name: "Night Drive",
  key: "A minor",
  tempo: 100,
  swing: 0.56,
  beatsPerBar: 4,
  cycleBars: 4,
  // A minor pentatonic from A3 to G5: no rung can clash with the harmony.
  ladder: [57, 60, 62, 64, 67, 69, 72, 74, 76, 79],
  progressions: {
    low: ["Am", "F", "C", "G"].map((name) => CHORDS[name]),
    high: ["F", "G", "Am", "C"].map((name) => CHORDS[name]),
  },
  tonic: CHORDS.Am,
  levels: ["Air", "Pulse", "Groove", "Drive", "Peak"],
};

export const cycleBeats = (world) => world.beatsPerBar * world.cycleBars;

export function chordAt(world, progression, bar) {
  const chords = world.progressions[progression];
  return chords[((bar % chords.length) + chords.length) % chords.length];
}

export const isChordTone = (pitch, chord) => chord.tones.includes(pitch % 12);
