import { afterEach, describe, expect, it, vi } from "vitest";

import { readPieces, readUpTo } from "./media-read";

const PIECE = 1000 * 1024;

/** Answers range requests the way the asset protocol does, and records what was asked. */
function serve(size: number) {
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init?: RequestInit) => {
      const range = new Headers(init?.headers).get("Range") ?? "";
      asked.push(range);
      const [from = 0, to = 0] = range.replace("bytes=", "").split("-").map(Number);
      if (from >= size) return Promise.resolve(new Response(null, { status: 416 }));
      const body = new Uint8Array(Math.min(to + 1, size) - from).fill(7);
      return Promise.resolve(new Response(body, { status: 206 }));
    }),
  );
  return asked;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reading media in pieces", () => {
  it("never asks for the whole file at once", async () => {
    const asked = serve(PIECE * 2 + 5);
    const sizes: number[] = [];
    for await (const piece of readPieces("asset://long.wav")) sizes.push(piece.length);
    expect(sizes).toEqual([PIECE, PIECE, 5]);
    expect(asked.every((range) => range.startsWith("bytes="))).toBe(true);
  });

  it("ends cleanly when the file ends exactly on a piece", async () => {
    serve(PIECE);
    let total = 0;
    for await (const piece of readPieces("asset://even.wav")) total += piece.length;
    expect(total).toBe(PIECE);
  });

  it("gives up on a file over the limit without reading the rest", async () => {
    const asked = serve(PIECE * 50);
    expect(await readUpTo("asset://huge.wav", PIECE)).toBeNull();
    expect(asked.length).toBe(2);
  });

  it("returns a small file whole", async () => {
    serve(1000);
    expect((await readUpTo("asset://hit.wav", PIECE))?.length).toBe(1000);
  });
});
