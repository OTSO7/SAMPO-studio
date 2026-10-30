import { describe, expect, it } from "vitest";

import { sampleStory } from "@core/testing/sample-story";
import type { Beat, Block } from "@core/model";
import { canExpand } from "./card-preview";

const base = sampleStory().phases[0]?.beats[0] as Beat;
const beat = (...blocks: Block[]): Beat => ({ ...base, blocks });
const text = (id: string, value = "Lyhyt."): Block =>
  ({ type: "action", id, text: value }) as Block;

describe("whether a card can expand", () => {
  it("does not for a card that already shows everything", () => {
    expect(canExpand(beat(text("a")))).toBe(false);
  });

  it("does for several sections of text, or a note, however short", () => {
    expect(canExpand(beat(text("a"), text("b")))).toBe(true);
    expect(
      canExpand(beat(text("a"), { type: "note", id: "n", kind: "idea", text: "x" } as Block)),
    ).toBe(true);
  });

  it("does for one long text", () => {
    expect(canExpand(beat(text("a", "x".repeat(200))))).toBe(true);
  });
});
