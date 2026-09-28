import { test } from "node:test";
import assert from "node:assert/strict";
import { DRUM_NOTES, decodeMidi, encodeMidi } from "../web/instrument/midi.js";
import { encodeWav } from "../web/instrument/wav.js";

test("MIDI export round-trips tempo, track names, and notes", () => {
  const bytes = encodeMidi({
    tempo: 100,
    tracks: [
      {
        name: "Lead",
        channel: 0,
        notes: [
          { pitch: 69, start: 0, beats: 1, velocity: 0.8 },
          { pitch: 72, start: 1.28, beats: 0.5, velocity: 1 },
        ],
      },
      {
        name: "Drums",
        channel: 9,
        notes: [
          { pitch: DRUM_NOTES.kick, start: 0, beats: 0.25, velocity: 0.9 },
        ],
      },
    ],
  });
  const midi = decodeMidi(bytes);
  assert.equal(Math.round(midi.tempo), 100);
  assert.equal(midi.ppq, 480);
  assert.deepEqual(
    midi.tracks.map((track) => track.name),
    ["Sway", "Lead", "Drums"],
  );
  assert.deepEqual(
    midi.tracks[1].notes.map(({ pitch, start, beats, velocity }) => [
      pitch,
      start,
      beats,
      velocity,
    ]),
    [
      [69, 0, 1, 102],
      [72, 614 / 480, 0.5, 127],
    ],
  );
  assert.equal(midi.tracks[2].notes[0].channel, 9);
});

test("a repeated pitch ends before it starts again", () => {
  const bytes = encodeMidi({
    tempo: 120,
    tracks: [
      {
        name: "Keys",
        channel: 2,
        notes: [
          { pitch: 60, start: 0, beats: 1, velocity: 0.5 },
          { pitch: 60, start: 1, beats: 1, velocity: 0.5 },
        ],
      },
    ],
  });
  const notes = decodeMidi(bytes).tracks[1].notes;
  assert.deepEqual(
    notes.map(({ start, beats }) => [start, beats]),
    [
      [0, 1],
      [1, 1],
    ],
  );
});

test("WAV export writes a valid 16-bit stereo header and clamps samples", () => {
  const left = new Float32Array([0, 0.5, -1, 2]);
  const right = new Float32Array([0, -0.5, 1, -2]);
  const view = new DataView(encodeWav(left, right, 48000));
  const text = (at) =>
    String.fromCharCode(...new Uint8Array(view.buffer, at, 4));
  assert.equal(text(0), "RIFF");
  assert.equal(text(8), "WAVE");
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 48000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 16);
  const samples = Array.from({ length: 8 }, (_, i) =>
    view.getInt16(44 + i * 2, true),
  );
  assert.deepEqual(
    samples,
    [0, 0, 16384, -16383, -32767, 32767, 32767, -32767],
  );
});
