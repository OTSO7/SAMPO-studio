/**
 * The outline of a sound for drawing its waveform: the loudest point in each of a few hundred
 * slices, from 0 to 1.
 *
 * A WAV is read in small pieces and measured as it goes, never loaded or decoded whole, so a
 * 300 MB track costs a little memory and one unhurried read of the file. Each track is measured once: the result is
 * kept for the session and in local storage, so a gig never waits for it twice. Other formats
 * are decoded by the browser, only when small enough for that to be harmless.
 */

import { readPieces } from "./media-read";

export type Peaks = Float32Array;

export const PEAK_COUNT = 480;
/** Compressed formats decode fully in memory; above this the waveform is left out. */
const MAX_DECODED_BYTES = 60 * 1024 * 1024;
const STORAGE_PREFIX = "sampo.peaks:";
/** The measuring happens while the song plays, so it gives way to it between pieces. */
const PAUSE_MS = 5;

const known = new Map<string, Peaks>();
const pending = new Map<string, Promise<Peaks | null>>();

/** The peaks if already measured, without starting anything. */
export function cachedPeaks(url: string): Peaks | null {
  const kept = known.get(url);
  if (kept !== undefined) return kept;
  const stored = readStored(url);
  if (stored !== null) known.set(url, stored);
  return stored;
}

/** Measures a sound once; later calls get the same answer. `null` when it cannot be read. */
export function loadPeaks(url: string): Promise<Peaks | null> {
  const ready = cachedPeaks(url);
  if (ready !== null) return Promise.resolve(ready);
  const running = pending.get(url);
  if (running !== undefined) return running;
  const job = measure(url)
    .catch(() => null)
    .then((peaks) => {
      pending.delete(url);
      if (peaks !== null) {
        known.set(url, peaks);
        writeStored(url, peaks);
      }
      return peaks;
    });
  pending.set(url, job);
  return job;
}

async function measure(url: string): Promise<Peaks | null> {
  const pieces = readPieces(url, PAUSE_MS);
  const first = await pieces.next();
  if (first.done === true) return null;
  const head = first.value;
  const isWav = head.length >= 12 && ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WAVE";
  if (isWav) {
    return wavPeaks(
      (async function* () {
        yield head;
        yield* pieces;
      })(),
    );
  }
  // Not a WAV: decode it whole, if it is small enough for that.
  const parts: Uint8Array[] = [head];
  let size = head.length;
  for await (const piece of pieces) {
    size += piece.length;
    if (size > MAX_DECODED_BYTES) return null;
    parts.push(piece);
  }
  return decodedPeaks(await new Blob(parts as BlobPart[]).arrayBuffer());
}

async function decodedPeaks(bytes: ArrayBuffer): Promise<Peaks | null> {
  if (typeof OfflineAudioContext === "undefined") return null;
  const audio = await new OfflineAudioContext(1, 1, 44_100).decodeAudioData(bytes);
  const samples = audio.getChannelData(0);
  const peaks = new Float32Array(PEAK_COUNT);
  const per = Math.max(1, Math.ceil(samples.length / PEAK_COUNT));
  for (let i = 0; i < samples.length; i++) {
    const slot = Math.min(PEAK_COUNT - 1, Math.floor(i / per));
    const level = Math.abs(samples[i] ?? 0);
    if (level > (peaks[slot] ?? 0)) peaks[slot] = level;
  }
  return normalise(peaks);
}

interface Format {
  readonly encoding: "int" | "float";
  readonly bits: number;
  readonly frameBytes: number;
  readonly frames: number;
}

/**
 * Peaks of a WAV arriving in pieces of any size. Reads the first channel, which is enough to
 * draw; handles 8, 16, 24 and 32-bit integer and 32-bit float samples. `null` for anything else.
 */
export async function wavPeaks(
  pieces: AsyncIterable<Uint8Array>,
  count = PEAK_COUNT,
): Promise<Peaks | null> {
  let header: Uint8Array = new Uint8Array(0);
  let format: Format | null = null;
  const peaks = new Float32Array(count);
  let perSlot = 1;
  let frame = 0;
  let carry: Uint8Array = new Uint8Array(0);

  for await (const piece of pieces) {
    if (format === null) {
      header = join(header, piece);
      const found = findData(header);
      if (found === "invalid") return null;
      if (found === null) {
        if (header.length > 1024 * 1024) return null; // No sound data where it should be.
        continue;
      }
      const fmt = found.fmt;
      const frameBytes = (fmt.bits / 8) * fmt.channels;
      if (frameBytes === 0) return null;
      format = {
        encoding: fmt.encoding,
        bits: fmt.bits,
        frameBytes,
        frames: Math.floor(found.size / frameBytes),
      };
      perSlot = Math.max(1, Math.ceil(format.frames / count));
      carry = header.subarray(found.offset);
      header = new Uint8Array(0);
    } else {
      carry = carry.length === 0 ? piece : join(carry, piece);
    }

    const view = new DataView(carry.buffer, carry.byteOffset, carry.byteLength);
    const whole = Math.floor(carry.length / format.frameBytes);
    const limit = Math.min(whole, format.frames - frame);
    for (let i = 0; i < limit; i++) {
      const level = Math.abs(sample(view, i * format.frameBytes, format));
      const slot = Math.min(count - 1, Math.floor(frame / perSlot));
      if (level > (peaks[slot] ?? 0)) peaks[slot] = level;
      frame++;
    }
    carry = carry.slice(whole * format.frameBytes);
    if (frame >= format.frames) break;
  }
  return format === null ? null : normalise(peaks);
}

function sample(view: DataView, at: number, format: Format): number {
  if (format.encoding === "float") return view.getFloat32(at, true);
  switch (format.bits) {
    case 8:
      return (view.getUint8(at) - 128) / 128;
    case 16:
      return view.getInt16(at, true) / 32_768;
    case 24: {
      const value = view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getInt8(at + 2) << 16);
      return value / 8_388_608;
    }
    default:
      return view.getInt32(at, true) / 2_147_483_648;
  }
}

/** Walks the RIFF chunks for `fmt ` and the start of `data`; `null` until enough has arrived. */
function findData(bytes: Uint8Array):
  | {
      fmt: { encoding: Format["encoding"]; bits: number; channels: number };
      offset: number;
      size: number;
    }
  | null
  | "invalid" {
  if (bytes.length < 12) return null;
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") return "invalid";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fmt: { encoding: Format["encoding"]; bits: number; channels: number } | null = null;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = ascii(bytes, at, 4);
    const size = view.getUint32(at + 4, true);
    if (id === "data") {
      if (fmt === null) return "invalid";
      return { fmt, offset: at + 8, size };
    }
    if (at + 8 + size > bytes.length) return null;
    if (id === "fmt ") {
      let tag = view.getUint16(at + 8, true);
      const channels = view.getUint16(at + 10, true);
      const bits = view.getUint16(at + 22, true);
      // WAVE_FORMAT_EXTENSIBLE names the real format in its sub-format GUID.
      if (tag === 0xfffe && size >= 26) tag = view.getUint16(at + 32, true);
      if (tag === 1 && [8, 16, 24, 32].includes(bits)) fmt = { encoding: "int", bits, channels };
      else if (tag === 3 && bits === 32) fmt = { encoding: "float", bits, channels };
      else return "invalid";
    }
    at += 8 + size + (size % 2); // Chunks are padded to an even length.
  }
  return null;
}

/** Quiet tracks are scaled up so their shape still reads. */
function normalise(peaks: Peaks): Peaks {
  let loudest = 0;
  for (const level of peaks) loudest = Math.max(loudest, level);
  if (loudest > 0) for (let i = 0; i < peaks.length; i++) peaks[i] = (peaks[i] ?? 0) / loudest;
  return peaks;
}

function join(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + length));
}

// The URL ends in the file's content hash, so it names the same sound on every run.
function storageKey(url: string): string {
  return STORAGE_PREFIX + (url.split(/[/\\]/u).pop() ?? url);
}

function readStored(url: string): Peaks | null {
  try {
    const text = localStorage.getItem(storageKey(url));
    if (text === null) return null;
    const bytes = Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
    return Float32Array.from(bytes, (byte) => byte / 255);
  } catch {
    return null;
  }
}

function writeStored(url: string, peaks: Peaks): void {
  try {
    const bytes = Uint8Array.from(peaks, (level) => Math.round(level * 255));
    localStorage.setItem(storageKey(url), btoa(String.fromCharCode(...bytes)));
  } catch {
    // Storage full or blocked: measured again next session, nothing else is lost.
  }
}
