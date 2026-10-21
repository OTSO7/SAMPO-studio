/**
 * Monotonic ULID generator: 48 bits of millisecond time followed by 80 random bits, both in
 * Crockford base32. Ids sort lexicographically in creation order, which keeps files and
 * diffs stable, and they are safe to generate offline on several machines at once.
 *
 * See https://github.com/ulid/spec
 */

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BASE = ENCODING.length;
const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;
const MAX_TIME = 2 ** 48 - 1;

export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export interface IdSource {
  now(): number;
  fillRandom(bytes: Uint8Array<ArrayBuffer>): void;
}

export const systemIdSource: IdSource = {
  now: () => Date.now(),
  fillRandom: (bytes) => {
    crypto.getRandomValues(bytes);
  },
};

export function createUlidGenerator(source: IdSource = systemIdSource): () => string {
  let lastTime = -1;
  let lastRandom: number[] = [];

  return () => {
    const now = source.now();

    // Within the same millisecond, or if the clock steps backwards, keep the previous
    // timestamp and increment the random part so ids stay strictly increasing.
    if (now <= lastTime) {
      lastRandom = increment(lastRandom);
    } else {
      lastTime = now;
      lastRandom = randomDigits(source);
    }

    return encodeTime(lastTime) + lastRandom.map((digit) => ENCODING.charAt(digit)).join("");
  };
}

function encodeTime(time: number): string {
  if (!Number.isInteger(time) || time < 0 || time > MAX_TIME) {
    throw new RangeError(`Cannot encode timestamp ${time} as a ULID.`);
  }

  let remaining = time;
  let encoded = "";
  for (let i = 0; i < TIME_LENGTH; i++) {
    encoded = ENCODING.charAt(remaining % BASE) + encoded;
    remaining = Math.floor(remaining / BASE);
  }
  return encoded;
}

function randomDigits(source: IdSource): number[] {
  const bytes = new Uint8Array(RANDOM_LENGTH);
  source.fillRandom(bytes);
  // 256 is a multiple of 32, so masking the low five bits keeps the distribution uniform.
  return Array.from(bytes, (byte) => byte & (BASE - 1));
}

function increment(digits: readonly number[]): number[] {
  const next = [...digits];
  for (let i = next.length - 1; i >= 0; i--) {
    const digit = next[i] ?? 0;
    if (digit < BASE - 1) {
      next[i] = digit + 1;
      return next;
    }
    next[i] = 0;
  }
  throw new RangeError("ULID random component overflowed within a single millisecond.");
}
