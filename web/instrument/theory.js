// Pitches are MIDI note numbers; musical time is counted in quarter-note beats.

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const noteName = (pitch) => NAMES[pitch % 12];
export const frequency = (pitch) => 440 * 2 ** ((pitch - 69) / 12);
export const clamp = (value, low = 0, high = 1) =>
  Math.min(high, Math.max(low, value));

// The velocity of a strike as quick as the player's usual one; the mix is balanced for it.
export const TYPICAL_VELOCITY = 0.72;

// Voicings are written out so every chord change keeps common tones in place.
export const CHORDS = {
  Am: { name: "Am", tones: [9, 0, 4], bass: 33, pad: [57, 60, 64, 67] },
  F: { name: "F", tones: [5, 9, 0], bass: 41, pad: [53, 57, 60, 64] },
  C: { name: "C", tones: [0, 4, 7], bass: 36, pad: [55, 60, 64, 67] },
  // No third: B would rub against the ladder's C, so G is voiced open.
  G: { name: "G", tones: [7, 2], bass: 43, pad: [55, 62, 64, 69] },
  // For the composer. Each leaves out the note a semitone from a rung: Dm its F (against
  // the ladder's E), and Em its B (against C).
  Dm: { name: "Dm", tones: [2, 9], bass: 38, pad: [50, 57, 60, 64] },
  Em: { name: "Em", tones: [4, 7], bass: 40, pad: [52, 55, 62, 67] },
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
  // The chords the composer may choose from.
  vocabulary: ["Am", "C", "Dm", "Em", "F", "G"],
  tonic: CHORDS.Am,
  levels: ["Air", "Pulse", "Groove", "Drive", "Peak"],
};

export const cycleBeats = (world) => world.beatsPerBar * world.cycleBars;

/** The chord of `bar` in a named progression, or in a composed cycle's list of chords. */
export function chordAt(world, progression, bar) {
  const chords = Array.isArray(progression)
    ? progression
    : world.progressions[progression];
  return chords[((bar % chords.length) + chords.length) % chords.length];
}

export const isChordTone = (pitch, chord) => chord.tones.includes(pitch % 12);
