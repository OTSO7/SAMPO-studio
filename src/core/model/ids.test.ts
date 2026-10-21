import { describe, expect, it } from "vitest";

import { createUlidGenerator, ULID_PATTERN, type IdSource } from "./id-generator";
import { createIdFactory, parseId } from "./ids";

function fakeSource(times: number[], fill = 0): IdSource {
  let call = 0;
  return {
    now: () => times[Math.min(call++, times.length - 1)] ?? 0,
    fillRandom: (bytes) => bytes.fill(fill),
  };
}

describe("createUlidGenerator", () => {
  it("produces 26 character Crockford base32 strings", () => {
    const next = createUlidGenerator();
    for (let i = 0; i < 100; i++) {
      expect(next()).toMatch(ULID_PATTERN);
    }
  });

  it("encodes the timestamp in the first ten characters", () => {
    const next = createUlidGenerator(fakeSource([0, 1, 32]));
    expect(next().slice(0, 10)).toBe("0000000000");
    expect(next().slice(0, 10)).toBe("0000000001");
    expect(next().slice(0, 10)).toBe("0000000010");
  });

  it("sorts by creation time", () => {
    const next = createUlidGenerator(fakeSource([1_700_000_000_000, 1_700_000_000_001]));
    const [earlier, later] = [next(), next()];
    expect(earlier < later).toBe(true);
  });

  it("stays strictly increasing within the same millisecond", () => {
    const next = createUlidGenerator(fakeSource([42]));
    const generated = Array.from({ length: 1000 }, () => next());

    expect(new Set(generated).size).toBe(generated.length);
    expect([...generated].sort()).toEqual(generated);
  });

  it("increments the random part instead of resetting it", () => {
    const next = createUlidGenerator(fakeSource([42], 0));
    expect(next().slice(10)).toBe("0000000000000000");
    expect(next().slice(10)).toBe("0000000000000001");
  });

  it("stays increasing when the clock steps backwards", () => {
    const next = createUlidGenerator(fakeSource([5000, 4000]));
    const [first, second] = [next(), next()];
    expect(first < second).toBe(true);
  });

  it("rejects timestamps outside the 48-bit range", () => {
    const next = createUlidGenerator(fakeSource([-1]));
    expect(() => next()).toThrow(RangeError);
  });
});

describe("createIdFactory", () => {
  it("prefixes ids with their kind", () => {
    const ids = createIdFactory(fakeSource([0]));
    expect(ids.story()).toMatch(/^st_/);
    expect(ids.phase()).toMatch(/^ph_/);
    expect(ids.beat()).toMatch(/^bt_/);
    expect(ids.block()).toMatch(/^bk_/);
    expect(ids.entity()).toMatch(/^en_/);
  });

  it("shares one monotonic sequence across kinds", () => {
    const ids = createIdFactory(fakeSource([7]));
    const beat = ids.beat().slice(3);
    const block = ids.block().slice(3);
    expect(beat < block).toBe(true);
  });
});

describe("parseId", () => {
  const ids = createIdFactory();

  it("accepts ids of the requested kind", () => {
    const beat = ids.beat();
    expect(parseId("beat", beat)).toBe(beat);
  });

  it("rejects ids of another kind", () => {
    expect(parseId("phase", ids.beat())).toBeNull();
  });

  it("rejects malformed values", () => {
    expect(parseId("beat", "bt_")).toBeNull();
    expect(parseId("beat", "bt_01JB3Z8Q4M6V2N7KXW9R0T5H1I")).toBeNull(); // I is not Crockford
    expect(parseId("beat", "bt_01jb3z8q4m6v2n7kxw9r0t5h1c")).toBeNull();
    expect(parseId("beat", 42)).toBeNull();
    expect(parseId("beat", null)).toBeNull();
  });
});
