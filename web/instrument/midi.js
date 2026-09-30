// Standard MIDI file (type 1) encoding. Positions are in beats as heard, swing included.

const PPQ = 480;

// General MIDI drum notes on channel 10.
export const DRUM_NOTES = {
  kick: 36,
  snare: 38,
  clap: 39,
  hat: 42,
  openhat: 46,
  crash: 49,
  shaker: 70,
};

function variableLength(value) {
  const bytes = [value & 0x7f];
  while ((value >>= 7)) bytes.unshift((value & 0x7f) | 0x80);
  return bytes;
}

const ascii = (text) => [...text].map((c) => c.charCodeAt(0) & 0x7f);

function chunk(type, body) {
  const length = body.length;
  return [
    ...ascii(type),
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    ...body,
  ];
}

function trackBody(events) {
  // Note-offs sort before note-ons at the same tick so repeated notes retrigger.
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body = [];
  let last = 0;
  for (const event of events) {
    body.push(...variableLength(event.tick - last), ...event.bytes);
    last = event.tick;
  }
  body.push(0x00, 0xff, 0x2f, 0x00);
  return body;
}

/**
 * tracks: [{ name, channel (0-15), notes: [{ pitch, start, beats, velocity (0-1) }] }]
 * Returns the file as a Uint8Array.
 */
export function encodeMidi({ tempo, tracks }) {
  const microseconds = Math.round(60_000_000 / tempo);
  const conductor = trackBody([
    { tick: 0, order: 0, bytes: [0xff, 0x03, 4, ...ascii("Sway")] },
    {
      tick: 0,
      order: 0,
      bytes: [
        0xff,
        0x51,
        0x03,
        (microseconds >> 16) & 0xff,
        (microseconds >> 8) & 0xff,
        microseconds & 0xff,
      ],
    },
    { tick: 0, order: 0, bytes: [0xff, 0x58, 0x04, 4, 2, 24, 8] },
    { tick: 0, order: 0, bytes: [0xff, 0x59, 0x02, 0, 1] }, // A minor.
  ]);
  const chunks = [conductor];
  for (const track of tracks) {
    const name = ascii(track.name).slice(0, 127);
    const events = [
      { tick: 0, order: 0, bytes: [0xff, 0x03, name.length, ...name] },
    ];
    for (const note of track.notes) {
      const on = Math.max(0, Math.round(note.start * PPQ));
      const off = Math.max(on + 1, Math.round((note.start + note.beats) * PPQ));
      const velocity = Math.max(
        1,
        Math.min(127, Math.round(note.velocity * 127)),
      );
      events.push(
        {
          tick: on,
          order: 1,
          bytes: [0x90 | track.channel, note.pitch, velocity],
        },
        { tick: off, order: 0, bytes: [0x80 | track.channel, note.pitch, 64] },
      );
    }
    chunks.push(trackBody(events));
  }
  const header = chunk("MThd", [
    0,
    1,
    0,
    chunks.length,
    (PPQ >> 8) & 0xff,
    PPQ & 0xff,
  ]);
  return new Uint8Array([
    ...header,
    ...chunks.flatMap((body) => chunk("MTrk", body)),
  ]);
}

/** Minimal reader used by tests and checks: notes per track, in beats. */
export function decodeMidi(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at, n) => String.fromCharCode(...bytes.slice(at, at + n));
  if (text(0, 4) !== "MThd") throw new Error("Not a MIDI file");
  const count = view.getUint16(10);
  const ppq = view.getUint16(12);
  let at = 14;
  const tracks = [];
  let tempo = null;
  for (let t = 0; t < count; t++) {
    if (text(at, 4) !== "MTrk") throw new Error("Missing track chunk");
    const end = at + 8 + view.getUint32(at + 4);
    at += 8;
    let tick = 0;
    const open = new Map();
    const track = { name: "", notes: [] };
    while (at < end) {
      let delta = 0,
        byte;
      do {
        byte = bytes[at++];
        delta = (delta << 7) | (byte & 0x7f);
      } while (byte & 0x80);
      tick += delta;
      const status = bytes[at++];
      if (status === 0xff) {
        const type = bytes[at++];
        const length = bytes[at++];
        if (type === 0x03) track.name = text(at, length);
        if (type === 0x51)
          tempo =
            60_000_000 /
            ((bytes[at] << 16) | (bytes[at + 1] << 8) | bytes[at + 2]);
        at += length;
      } else {
        const kind = status & 0xf0;
        const [pitch, velocity] = [bytes[at++], bytes[at++]];
        const key = `${status & 0x0f}:${pitch}`;
        if (kind === 0x90 && velocity > 0)
          open.set(key, { tick, velocity, channel: status & 0x0f });
        else if (kind === 0x80 || kind === 0x90) {
          const start = open.get(key);
          if (start) {
            track.notes.push({
              pitch,
              channel: start.channel,
              start: start.tick / ppq,
              beats: (tick - start.tick) / ppq,
              velocity: start.velocity,
            });
            open.delete(key);
          }
        }
      }
    }
    tracks.push(track);
    at = end;
  }
  return { tempo, ppq, tracks };
}
