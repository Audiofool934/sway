// Chapters 7 to 10, the digital half: counting, connecting, assembling, delegating. The
// tune is now played by FM and drum-machine voices, sampled and re-pitched, stacked into
// a produced track, and finally left to loops that arrange themselves.

import { BAR, BEAT, atBar } from "../src/timeline.js";
import { cues, chordOfBar, motif } from "../src/score.js";
import { SR, TAU, crush, filter, mtof, rng, samples } from "./dsp.js";
import * as I from "./instruments.js";
import { duck } from "./mixer.js";
import { swung, voice } from "./eras.js";

const sortedTones = (bar) => [...chordOfBar(bar).pad].sort((a, b) => a - b);

/** Linear-interpolated resampling: ratio 2 plays an octave up (and half as long). */
function repitch(buffer, ratio) {
  const out = new Float32Array(Math.floor(buffer.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const j = Math.floor(pos);
    const next = j + 1 < buffer.length ? buffer[j + 1] : 0;
    out[i] =
      (j < buffer.length ? buffer[j] : 0) * (1 - (pos - j)) + next * (pos - j);
  }
  return out;
}

const hitsOf = (pattern) =>
  [...pattern].map((c, step) => (c === "x" ? step : -1)).filter((s) => s >= 0);

// ---------------------------------------------------------------------------------------
// 7. Count: the tune is sampled; the sampling gets finer, and the sound resolves with it.
export function count(m) {
  const { steps, alias, sampling } = cues.count;
  const stem = "count";
  const fp = (midi, dur, vel) =>
    voice(`fp${midi}-${dur.toFixed(2)}-${vel}`, () =>
      I.fmPiano({ midi, vel, dur }),
    );
  const bell = (midi, dur, vel) =>
    voice(`fb${midi}-${dur.toFixed(2)}-${vel}`, () =>
      I.fmBell({ midi, vel, dur }),
    );

  for (const startBar of [40, 44])
    for (const note of motif(startBar))
      m.put(fp(note.midi, note.dur * 0.95, 0.85), note.t, {
        gain: 0.8,
        pan: 0.05,
        stem,
        hall: 0.25,
        room: 0.08,
      });
  for (let bar = 40; bar < 48; bar++) {
    const tones = sortedTones(bar);
    // A glassy arpeggio of the chord, and its bass.
    for (let step = 0; step < 8; step++) {
      const midi = tones[[0, 1, 2, 3, 2, 1, 3, 2][step]] + 12;
      m.put(bell(midi, 0.55, 0.5), atBar(bar, step / 2), {
        gain: bar < 44 ? 0.3 : 0.2,
        pan: step % 2 ? 0.35 : -0.35,
        stem,
        hall: 0.3,
      });
    }
    m.put(
      voice(`cs${chordOfBar(bar).bass}`, () =>
        I.subBass({
          midi: chordOfBar(bar).bass + 12,
          dur: BAR * 0.9,
          vel: 0.75,
        }),
      ),
      atBar(bar),
      { gain: 0.5, stem },
    );
  }
  // The digital clock: a hat on every eighth note from bar 44, then a roll and a riser out.
  for (let b = 44 * 8; b < 48 * 8; b++)
    m.put(
      voice("clk", () => I.hat({ vel: 0.5, seed: 21 })),
      (b * BEAT) / 2,
      { gain: 0.22, pan: 0.3 },
    );
  for (let s = 8; s < 16; s++)
    m.put(
      voice(`roll${s}`, () =>
        I.snare({ vel: 0.2 + 0.07 * (s - 8), tone: 200 }),
      ),
      atBar(47, s / 4),
      { gain: 0.5, pan: -0.1, room: 0.1 },
    );
  m.put(I.riser({ dur: BAR, vel: 0.8 }), atBar(47), { gain: 0.5, hall: 0.2 });
  for (let step = 0; step < 16; step++)
    m.put(
      voice(`bl${step % 4}`, () =>
        I.blip({ midi: [69, 72, 76, 79][step % 4] + 12, vel: 0.6 }),
      ),
      atBar(46, step / 4),
      { gain: 0.1, pan: -0.3, echo: 0.3 },
    );

  // Aliasing, made audible: a sine rising past half the sampling rate folds back down.
  const sweepLength = samples(alias.dur);
  const sweep = new Float32Array(sweepLength);
  let phase = 0;
  for (let i = 0; i < sweepLength; i++) {
    const f = 300 * (9000 / 300) ** (i / sweepLength);
    phase += (TAU * f) / SR;
    sweep[i] = Math.sin(phase) * Math.sin((Math.PI * i) / sweepLength) ** 0.5;
  }
  m.put(crush(sweep, { rate: 6000, bits: 8 }), alias.t, {
    gain: 0.16,
    pan: 0,
    hall: 0.1,
  });

  // The stem is crushed on a schedule that matches the picture's sampling steps.
  m.after("count", () => {
    const from = sampling;
    const to = steps.at(-1).t;
    const stepAt = (t) =>
      steps.filter((s) => s.t <= from + t).at(-1) ?? steps[0];
    // The converter's reconstruction filter follows the sampling rate; what was not
    // band-limited before sampling still folds back (aliasing), which is the lesson.
    const digitize = (x) => {
      const y = crush(x, {
        rate: (t) => stepAt(t).rate,
        bits: (t) => stepAt(t).bits,
      });
      const cutoff = (i) => Math.min(9000, stepAt(i / SR).rate * 0.42);
      filter(y, "lowpass", cutoff, 0.7);
      return filter(y, "lowpass", cutoff, 0.7);
    };
    m.stem(stem).bus.region(from, to, (L, R) => ({
      L: digitize(L),
      R: digitize(R),
    }));
  });
}

// ---------------------------------------------------------------------------------------
// 8. Connect: a drum machine, MIDI keys, and a sampler.

const DRUM_STEP_VEL = {
  kick: (s) => (s % 4 === 0 ? 0.95 : 0.8),
  snare: () => 0.85,
  hat: (s) => (s % 4 === 0 ? 0.6 : 0.4),
  open: () => 0.5,
  cow: () => 0.45,
};

/** Schedule the pattern rows of the drum machine for bars `from` to `to` (exclusive). */
function drums(
  m,
  from,
  to,
  { stem = null, gain = 1, rows = cues.connect.rows } = {},
) {
  const kicks = [];
  for (let bar = from; bar < to; bar++) {
    const fill = cues.connect.fills.includes(bar);
    for (const [name, row] of Object.entries(rows)) {
      if (bar < row.from || name === "chop") continue;
      for (const step of hitsOf(row.pattern)) {
        if (fill && name === "snare" && step >= 12) continue;
        const t = swung(bar, step / 4);
        const vel = DRUM_STEP_VEL[name](step);
        const dest = { gain: gain * 0.7, stem, room: 0.08 };
        if (name === "kick") {
          kicks.push(t);
          m.put(
            voice("k808", () => I.kick({ vel: 0.95 })),
            t,
            { ...dest, gain: gain * 0.95, pan: 0 },
          );
        } else if (name === "snare") {
          m.put(
            voice("sn808", () => I.snare({ vel })),
            t,
            { ...dest, gain: gain * 0.85, room: 0.15 },
          );
        } else if (name === "hat")
          m.put(
            voice(`h${step % 4}`, () => I.hat({ vel, seed: 14 + (step % 4) })),
            t,
            { ...dest, gain: gain * 0.62, pan: 0.25 },
          );
        else if (name === "open")
          m.put(
            voice("oh", () => I.hat({ vel, open: true })),
            t,
            { ...dest, gain: gain * 0.6, pan: 0.3 },
          );
        else if (name === "cow")
          m.put(
            voice("cb", () => I.cowbell({ vel })),
            t,
            { ...dest, gain: gain * 0.5, pan: -0.25 },
          );
      }
    }
    if (fill)
      for (let step = 12; step < 16; step++)
        m.put(
          voice(`fl${step}`, () =>
            I.snare({ vel: 0.35 + 0.15 * (step - 12), tone: 200 }),
          ),
          swung(bar, step / 4),
          { gain: gain * 0.6, stem, room: 0.15 },
        );
  }
  return kicks;
}

/** Claps layered on the snare, and a sixteenth-note shaker, for the produced track. */
function extras(m, from, to, { stem = null, gain = 1 } = {}) {
  for (let bar = from; bar < to; bar++) {
    if (!cues.connect.fills.includes(bar))
      for (const step of hitsOf(cues.connect.rows.snare.pattern))
        m.put(
          voice("cl808", () => I.clap({ vel: 0.6 })),
          swung(bar, step / 4),
          { gain: gain * 0.5, stem, room: 0.2, pan: 0.1 },
        );
    for (let step = 0; step < 16; step++)
      m.put(
        voice(`sh${step % 2}`, () =>
          I.shaker({ vel: step % 2 ? 0.35 : 0.5, seed: 15 + (step % 2) }),
        ),
        swung(bar, step / 4),
        { gain: gain * 0.5, stem, pan: -0.3 },
      );
  }
}

/**
 * The sampler's source: an open fifth (A, E, A) on a player piano, recorded with a little grit.
 * With no third it stays in key when re-pitched to F, C, or G, as Sway's own voicing of G does.
 */
const chopSample = () =>
  voice("chop", () => {
    const length = samples(0.7);
    const out = new Float32Array(length);
    for (const midi of [57, 64, 69]) {
      const note = I.piano({
        midi,
        vel: 0.85,
        dur: 0.3,
        honky: 5,
        seed: 90 + midi,
      });
      for (let i = 0; i < Math.min(length, note.length); i++) out[i] += note[i];
    }
    filter(out, "highpass", 200, 0.7);
    filter(out, "lowpass", 5200, 0.7);
    const grit = crush(out, { rate: 22050, bits: 10 });
    let peak = 0;
    for (const v of grit) peak = Math.max(peak, Math.abs(v));
    return grit.map((v) => (v * 0.6) / peak);
  });

/** Sample-triggered stabs: the same chord, re-pitched to each bar's root, as an MPC pad would. */
function chops(m, from, to, { stem = null, gain = 1 } = {}) {
  const shifts = { Am: 0, F: -4, C: 3, G: -2 };
  for (let bar = from; bar < to; bar++) {
    const ratio = 2 ** (shifts[chordOfBar(bar).name] / 12);
    for (const [i, step] of hitsOf(cues.connect.rows.chop.pattern).entries()) {
      const sample = voice(`chop${ratio.toFixed(3)}`, () =>
        repitch(chopSample(), ratio),
      );
      m.put(sample, swung(bar, step / 4), {
        gain: gain * (i % 2 ? 0.7 : 0.9),
        pan: i % 2 ? 0.3 : -0.3,
        stem,
        room: 0.12,
        echo: 0.1,
      });
    }
  }
}

function bassLine(m, from, to, { stem = null, gain = 0.6 } = {}) {
  for (let bar = from; bar < to; bar++) {
    const chord = chordOfBar(bar);
    const next = chordOfBar(bar + 1);
    for (const [step, beats, midi] of [
      [0, 1.4, chord.bass + 12],
      [6, 0.5, chord.bass + 12],
      [10, 0.9, chord.bass + 12],
      [14, 0.4, next.bass + 12],
    ])
      m.put(
        voice(`sb${midi}-${beats}`, () =>
          I.subBass({ midi, dur: beats * BEAT, vel: 0.85, bite: 0.5 }),
        ),
        swung(bar, step / 4),
        { gain, stem },
      );
  }
}

export function connect(m) {
  drums(m, 48, 56);
  bassLine(m, 48, 56, { gain: 0.7 });
  // MIDI keys: an electric-piano chord on each of three steps per bar.
  for (let bar = 48; bar < 56; bar++)
    for (const step of [0, 7, 10])
      for (const midi of chordOfBar(bar).pad)
        m.put(
          voice(`kp${midi}`, () => I.fmPiano({ midi, vel: 0.5, dur: 0.4 })),
          swung(bar, step / 4),
          { gain: 0.2, pan: -0.15, hall: 0.2, room: 0.1 },
        );
  for (const startBar of [48, 52])
    for (const note of motif(startBar)) {
      m.put(
        voice(`fp${note.midi}-${note.dur.toFixed(2)}-0.85`, () =>
          I.fmPiano({ midi: note.midi, vel: 0.85, dur: note.dur * 0.95 }),
        ),
        note.t,
        { gain: 0.55, pan: 0.1, hall: 0.3, room: 0.1 },
      );
      if (startBar === 52)
        m.put(
          voice(`fb${note.midi + 12}`, () =>
            I.fmBell({ midi: note.midi + 12, vel: 0.5, dur: 1.2 }),
          ),
          note.t,
          { gain: 0.2, pan: 0.35, hall: 0.35 },
        );
    }
  chops(m, 52, 56);
  m.put(I.riser({ dur: BAR, vel: 0.7 }), atBar(55), { gain: 0.4, hall: 0.2 });
}

// ---------------------------------------------------------------------------------------
// 9. Assemble: the whole track, layer by layer, then a hard stop.
export function assemble(m) {
  const { layers, stop } = cues.assemble;
  const bar = (id) => layers.find((l) => l.id === id).bar;
  const dry = "assemble";
  const pumped = "pump";
  const kicks = drums(m, bar("drums"), 64, { stem: dry, gain: 1 });
  // From bar 60 the groove gains claps and a shaker.
  extras(m, bar("claps"), 64, { stem: dry });
  bassLine(m, bar("bass"), 64, { stem: pumped, gain: 0.72 });
  for (const startBar of [56, 60])
    for (const note of motif(startBar)) {
      m.put(
        voice(`fp${note.midi}-${note.dur.toFixed(2)}-0.85`, () =>
          I.fmPiano({ midi: note.midi, vel: 0.85, dur: note.dur * 0.95 }),
        ),
        note.t,
        { gain: 0.6, pan: 0.1, stem: dry, hall: 0.3, room: 0.1 },
      );
      if (startBar >= bar("bells"))
        m.put(
          voice(`fb${note.midi + 12}`, () =>
            I.fmBell({ midi: note.midi + 12, vel: 0.5, dur: 1.2 }),
          ),
          note.t,
          { gain: 0.24, pan: 0.35, stem: dry, hall: 0.35 },
        );
    }
  // The pad: a detuned-saw chord a bar, brightening as the track fills.
  for (let b = bar("pad"); b < 64; b++)
    m.put(
      voice(`pad${b}`, () =>
        I.pad({
          midis: chordOfBar(b).pad,
          dur: BAR,
          vel: 0.7,
          bright: 0.35 + 0.05 * (b - 57),
          attack: 0.35,
          release: 0.6,
          seed: b,
        }),
      ),
      atBar(b),
      { gain: 0.42, stem: pumped, hall: 0.4 },
    );
  chops(m, bar("chops"), 64, { stem: pumped, gain: 0.75 });
  // The arpeggio, in sixteenths with an echo.
  const order = [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1, 2, 3];
  for (let b = bar("arp"); b < 64; b++) {
    const chord = chordOfBar(b);
    const notes = [...chord.pad, ...chord.pad.map((p) => p + 12)];
    for (let step = 0; step < 16; step++)
      m.put(
        voice(`ar${notes[order[step] % notes.length]}`, () =>
          I.blip({
            midi: notes[order[step] % notes.length],
            vel: 0.6,
            dur: 0.14,
          }),
        ),
        swung(b, step / 4),
        { gain: 0.16, pan: 0.3, stem: pumped, echo: 0.4, hall: 0.1 },
      );
  }
  m.put(
    voice("crash", () => I.crash({ vel: 0.7 })),
    atBar(bar("claps")),
    { gain: 0.5, stem: dry, hall: 0.2 },
  );
  // Riser and snare roll into the stop.
  m.put(
    I.riser({ dur: stop - cues.assemble.riser, vel: 0.9 }),
    cues.assemble.riser,
    { gain: 0.5, stem: dry, hall: 0.15 },
  );
  for (let s = 8; s < 16; s++)
    m.put(
      voice(`rr${s}`, () => I.snare({ vel: 0.25 + 0.07 * (s - 8), tone: 200 })),
      atBar(63, s / 4),
      { gain: 0.6, stem: dry, room: 0.1 },
    );
  m.after("assemble", () => {
    duck(m.stem(pumped).bus, kicks, { depth: 0.55, release: 0.2 });
    // The DAW stops: everything dry is gone on the bar line; only the rooms ring on.
    for (const name of [dry, pumped])
      m.stem(name).bus.gainCurve(
        (t) => (t >= stop ? 0 : t > stop - 0.012 ? (stop - t) / 0.012 : 1),
        stop - 0.05,
        stop + 4,
      );
  });
}

// ---------------------------------------------------------------------------------------
// 10. Delegate: loops of unequal lengths, then a cloud of notes, then a pulse.
export function delegate(m) {
  const { loops, start } = cues.delegate;
  const end = atBar(72);
  const voices = {
    box: (midi) => voice(`mb${midi}`, () => I.musicBox({ midi, vel: 0.7 })),
    bell: (midi) =>
      voice(`gb${midi}`, () => I.fmBell({ midi, vel: 0.55, dur: 2.6 })),
    low: (midi) =>
      voice(`lb${midi}`, () =>
        I.sineBell({ freq: mtof(midi), dur: 4.5, vel: 0.8, decay: 2.2 }),
      ),
    spark: (midi) =>
      voice(`sp${midi}`, () =>
        I.fmBell({ midi, vel: 0.5, dur: 1.6, ratio: 2.76, index: 3 }),
      ),
  };
  const pans = { box: -0.4, bell: 0.3, low: 0, spark: 0.55 };
  const gains = { box: 0.55, bell: 0.5, low: 0.6, spark: 0.4 };
  for (const loop of loops) {
    const length = loop.beats * BEAT;
    const first = loop.enters ?? start;
    for (let cycle = 0; first + cycle * length < end; cycle++)
      for (const [beat, midi] of loop.notes) {
        const t = first + cycle * length + beat * BEAT;
        if (t >= end) continue;
        m.put(voices[loop.id](midi), t, {
          gain: gains[loop.id],
          pan: pans[loop.id],
          hall: 1.0,
          echo: loop.id === "box" ? 0.25 : 0.12,
        });
      }
  }
  // A cloud of quiet notes while the model "writes": random, but always on the ladder.
  const r = rng(404);
  const ladder = [57, 60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84];
  for (let i = 0; i < 46; i++) {
    const t = atBar(68) + r() * BAR * 3.6;
    const midi = ladder[Math.floor(r() * ladder.length)];
    m.put(
      voice(`sb${midi}`, () =>
        I.sineBell({ freq: mtof(midi + 12), dur: 2.2, vel: 0.6, decay: 0.9 }),
      ),
      t,
      { gain: 0.16 + r() * 0.08, pan: r() * 1.6 - 0.8, hall: 1.0 },
    );
  }
  // A slow pad takes over the harmony, and a heartbeat arrives under the last two bars.
  for (let b = 68; b < 72; b++)
    m.put(
      voice(`dp${b}`, () =>
        I.pad({
          midis: chordOfBar(b).pad,
          dur: BAR,
          vel: 0.6,
          bright: 0.25,
          attack: 1.4,
          release: 1.4,
          seed: 70 + b,
        }),
      ),
      atBar(b) - 0.6,
      { gain: 0.3, hall: 0.8 },
    );
  for (let beat = 70 * 4; beat < 72 * 4; beat++)
    m.put(
      voice("hb", () => I.kick({ vel: 0.5, tune: 52, decay: 0.3 })),
      beat * BEAT,
      { gain: 0.5 },
    );
  m.put(I.riser({ dur: BAR, vel: 0.7 }), atBar(71), { gain: 0.4, hall: 0.3 });
}

export const digitalEras = [count, connect, assemble, delegate];
