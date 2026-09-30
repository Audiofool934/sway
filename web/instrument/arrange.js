// What the band's harmony plays in each bar of a cycle's plan: the chord voicing in the
// plan's texture, and the answering line an octave below the ladder. Generated harmony
// renders these notes; when a bar has not arrived, the synthesized band plays them.

import { applySwing } from "./clock.js";

export const TEXTURES = ["hold", "pulse", "arpeggio"];
// The answering line sits an octave below the player's ladder, under the lead.
export const ANSWER_OCTAVE = -12;
const SIXTEENTHS = 4; // Per beat.

/**
 * Harmony notes for one bar, in beats from its start: { pitch, start, length, tie }. A
 * tied note continues from the previous bar and is not struck again.
 */
export function harmonyNotes({ chord, texture, previous = null, world }) {
  const beats = world.beatsPerBar;
  if (texture === "pulse")
    return chord.pad.flatMap((pitch) =>
      Array.from({ length: beats }, (_, beat) => ({
        pitch,
        start: beat,
        length: 1,
        tie: false,
      })),
    );
  if (texture === "arpeggio") {
    // Eighth notes up through the voicing; the band's swing moves only sixteenths.
    const order = [...chord.pad].sort((a, b) => a - b);
    return Array.from({ length: beats * 2 }, (_, i) => ({
      pitch: order[i % order.length],
      start: i / 2,
      length: 0.5,
      tie: false,
    }));
  }
  // Held chords carry common tones across the bar line, as the voicings are written to.
  const carried =
    previous?.texture === "hold" ? new Set(previous.chord.pad) : new Set();
  return chord.pad.map((pitch) => ({
    pitch,
    start: 0,
    length: beats,
    tie: carried.has(pitch),
  }));
}

/** The answering line's notes that sound in bar `barInCycle`, as harmony notes. */
export function answerNotes({ answer, barInCycle, world }) {
  const barLength = world.beatsPerBar * SIXTEENTHS;
  const barStart = barInCycle * barLength;
  const notes = [];
  for (const note of answer) {
    const start = note.at;
    const end = note.at + note.len;
    if (end <= barStart || start >= barStart + barLength) continue;
    const from = Math.max(start, barStart);
    const to = Math.min(end, barStart + barLength);
    const begin = applySwing((from - barStart) / SIXTEENTHS, world.swing);
    notes.push({
      pitch: world.ladder[note.rung] + ANSWER_OCTAVE,
      start: begin,
      length: Math.max(
        0.05,
        applySwing((to - barStart) / SIXTEENTHS, world.swing) - begin,
      ),
      tie: start < barStart,
    });
  }
  return notes;
}

/** The answering line's notes that begin on `step` of a cycle, as band events. */
export function answerEvents({ answer, stepInCycle, world }) {
  return answer
    .filter((note) => note.at === stepInCycle)
    .map((note) => ({
      part: "answer",
      step: stepInCycle,
      beats: note.len / SIXTEENTHS,
      velocity: 0.6,
      pitch: world.ladder[note.rung] + ANSWER_OCTAVE,
    }));
}

/**
 * A composer's plan made safe to play: known chords, a known texture, and an answering
 * line of whole sixteenths on the ladder that fits the cycle without overlapping itself.
 * Returns null when the plan cannot be used.
 */
export function cleanPlan(plan, { world, chords }) {
  if (!plan || typeof plan !== "object") return null;
  const cycleLength = world.cycleBars * world.beatsPerBar * SIXTEENTHS;
  if (!Array.isArray(plan.chords) || plan.chords.length !== world.cycleBars)
    return null;
  if (!plan.chords.every((name) => world.vocabulary.includes(name)))
    return null;
  if (!TEXTURES.includes(plan.texture)) return null;
  const answer = [];
  let free = 0; // The first sixteenth not yet taken by an earlier note.
  const notes = Array.isArray(plan.answer) ? plan.answer : [];
  for (const note of [...notes].sort((a, b) => a?.at - b?.at)) {
    const { rung, at, len } = note ?? {};
    if (![rung, at, len].every(Number.isInteger)) continue;
    if (rung < 0 || rung >= world.ladder.length || at < free || len < 1)
      continue;
    if (at >= cycleLength) continue;
    const fitted = Math.min(len, 16, cycleLength - at);
    answer.push({ rung, at, len: fitted });
    free = at + fitted;
    if (answer.length === 8) break;
  }
  const caption =
    typeof plan.caption === "string"
      ? plan.caption.replace(/\s+/g, " ").trim().slice(0, 90)
      : "";
  return {
    chords: plan.chords.map((name) => chords[name]),
    names: [...plan.chords],
    texture: plan.texture,
    answer,
    caption,
  };
}
