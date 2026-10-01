// Minimal WAV I/O: 32-bit float stereo or mono, which ffmpeg and the analysis tools read.

import { readFileSync, writeFileSync } from "node:fs";

export function writeWav(path, channels, sampleRate) {
  const count = channels.length;
  const frames = channels[0].length;
  const data = Buffer.alloc(frames * count * 4);
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < count; c++)
      data.writeFloatLE(channels[c][i], (i * count + c) * 4);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20); // IEEE float
  header.writeUInt16LE(count, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * count * 4, 28);
  header.writeUInt16LE(count * 4, 32);
  header.writeUInt16LE(32, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([header, data]));
}

/** Read a float32 or 16-bit PCM WAV into per-channel Float32Arrays. */
export function readWav(path) {
  const buffer = readFileSync(path);
  let offset = 12;
  let format = null;
  while (offset < buffer.length - 8) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      format = {
        tag: buffer.readUInt16LE(offset + 8),
        channels: buffer.readUInt16LE(offset + 10),
        rate: buffer.readUInt32LE(offset + 12),
        bits: buffer.readUInt16LE(offset + 22),
      };
    } else if (id === "data") {
      const bytes = format.bits / 8;
      const frames = Math.floor(size / (bytes * format.channels));
      const channels = Array.from(
        { length: format.channels },
        () => new Float32Array(frames),
      );
      for (let i = 0; i < frames; i++)
        for (let c = 0; c < format.channels; c++) {
          const at = offset + 8 + (i * format.channels + c) * bytes;
          channels[c][i] =
            format.tag === 3
              ? buffer.readFloatLE(at)
              : buffer.readInt16LE(at) / 32768;
        }
      return { channels, rate: format.rate };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("no data chunk");
}
