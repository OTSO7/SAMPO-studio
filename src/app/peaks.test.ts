import { describe, expect, it } from "vitest";

import { wavPeaks } from "./peaks";

/** A WAV file of `frames` frames whose first channel follows `level(frame)` from -1 to 1. */
function wav(
  frames: number,
  level: (frame: number) => number,
  { bits = 16, channels = 2, float = false, extraChunk = false } = {},
): Uint8Array {
  const frameBytes = (bits / 8) * channels;
  const extra = extraChunk ? 8 + 5 + 1 : 0; // An odd-sized LIST chunk, padded.
  const out = new Uint8Array(44 + extra + frames * frameBytes);
  const view = new DataView(out.buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) out[at + i] = value.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, out.length - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, float ? 3 : 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, 48_000, true);
  view.setUint16(32, frameBytes, true);
  view.setUint16(34, bits, true);
  let at = 36;
  if (extraChunk) {
    text(at, "LIST");
    view.setUint32(at + 4, 5, true);
    at += 8 + 6;
  }
  text(at, "data");
  view.setUint32(at + 4, frames * frameBytes, true);
  at += 8;
  for (let frame = 0; frame < frames; frame++) {
    const value = level(frame);
    const offset = at + frame * frameBytes;
    if (float) view.setFloat32(offset, value, true);
    else if (bits === 16) view.setInt16(offset, Math.round(value * 32_767), true);
    else if (bits === 24) {
      const int = Math.round(value * 8_388_607);
      view.setUint8(offset, int & 0xff);
      view.setUint8(offset + 1, (int >> 8) & 0xff);
      view.setInt8(offset + 2, int >> 16);
    }
  }
  return out;
}

/** Hands the bytes over in awkward pieces, as a network or disk stream does. */
async function* pieces(bytes: Uint8Array, size: number) {
  for (let at = 0; at < bytes.length; at += size) {
    await Promise.resolve();
    yield bytes.slice(at, at + size);
  }
}

/** Silent first half, loud second half. */
const halfLoud = (frames: number) => (frame: number) => (frame < frames / 2 ? 0 : 0.5);

describe("waveform peaks from a streamed WAV", () => {
  it("finds the shape in 16-bit stereo arriving in odd-sized pieces", async () => {
    const bytes = wav(10_000, halfLoud(10_000));
    const peaks = await wavPeaks(pieces(bytes, 7), 10);
    expect(peaks).not.toBeNull();
    expect([...(peaks ?? [])].map((p) => Math.round(p))).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 1]);
  });

  it("reads 24-bit and 32-bit float, and skips other chunks before the sound", async () => {
    for (const options of [{ bits: 24 }, { bits: 32, float: true }]) {
      const bytes = wav(4_000, halfLoud(4_000), { ...options, extraChunk: true });
      const peaks = await wavPeaks(pieces(bytes, 1_000), 4);
      expect([...(peaks ?? [])].map((p) => Math.round(p))).toEqual([0, 0, 1, 1]);
    }
  });

  it("refuses what it cannot read instead of drawing nonsense", async () => {
    const junk = new TextEncoder().encode("ID3 not a wav at all, an mp3 maybe");
    expect(await wavPeaks(pieces(junk, 5))).toBeNull();
  });

  it("stays fast and small on a long track", async () => {
    const frames = 48_000 * 60; // A minute of 16-bit stereo, about 11 MB.
    const bytes = wav(frames, (frame) => Math.sin(frame / 50) * (frame / frames));
    const started = performance.now();
    const peaks = await wavPeaks(pieces(bytes, 64 * 1024));
    expect(peaks?.length).toBe(480);
    // A crescendo: the end is louder than the start.
    expect(peaks?.[470] ?? 0).toBeGreaterThan((peaks?.[10] ?? 1) * 5);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
