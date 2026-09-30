// 16-bit PCM WAV encoding from separate left and right channels.

export function encodeWav(left, right, sampleRate) {
  const frames = left.length;
  const buffer = new ArrayBuffer(44 + frames * 4);
  const view = new DataView(buffer);
  const text = (at, value) => {
    for (let i = 0; i < value.length; i++)
      view.setUint8(at + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + frames * 4, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM.
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, frames * 4, true);
  const pcm = (x) => Math.round(Math.max(-1, Math.min(1, x)) * 32767);
  for (let i = 0, at = 44; i < frames; i++, at += 4) {
    view.setInt16(at, pcm(left[i]), true);
    view.setInt16(at + 2, pcm(right[i]), true);
  }
  return buffer;
}
