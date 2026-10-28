import { describe, expect, it } from "vitest";

import { Assembler, splitEdit } from "./pieces";

const edit = (size: number) => Uint8Array.from({ length: size }, (_, i) => i % 251);

describe("splitEdit and Assembler", () => {
  it("passes a small edit through in one piece", () => {
    const pieces = splitEdit(edit(100), 1000);
    expect(pieces).toHaveLength(1);
    expect(new Assembler().add(pieces[0] ?? new Uint8Array(), 1)).toEqual(edit(100));
  });

  it("puts a large edit back together, in any order", () => {
    const original = edit(2500);
    const pieces = splitEdit(original, 1000);
    expect(pieces).toHaveLength(3);
    const assembler = new Assembler();
    expect(assembler.add(pieces[2] ?? new Uint8Array(), 12)).toBeNull();
    expect(assembler.add(pieces[0] ?? new Uint8Array(), 10)).toBeNull();
    expect(assembler.oldestIncomplete()).toBe(10);
    expect(assembler.add(pieces[1] ?? new Uint8Array(), 11)).toEqual(original);
    expect(assembler.oldestIncomplete()).toBeNull();
  });

  it("keeps edits apart and treats a message without the envelope as whole", () => {
    const assembler = new Assembler();
    const a = splitEdit(edit(1500), 1000);
    const b = splitEdit(edit(1800), 1000);
    expect(assembler.add(a[0] ?? new Uint8Array(), 1)).toBeNull();
    expect(assembler.add(b[0] ?? new Uint8Array(), 2)).toBeNull();
    expect(assembler.add(b[1] ?? new Uint8Array(), 3)).toEqual(edit(1800));
    expect(assembler.add(new Uint8Array([7, 7]), 4)).toEqual(new Uint8Array([7, 7]));
    expect(assembler.oldestIncomplete()).toBe(1);
  });

  it("drops edits whose sender stopped halfway", () => {
    const assembler = new Assembler();
    assembler.add(splitEdit(edit(1500), 1000)[0] ?? new Uint8Array(), 5, 1000);
    assembler.dropStale(2000);
    expect(assembler.oldestIncomplete()).toBeNull();
  });
});
