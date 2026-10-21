import { describe, expect, it } from "vitest";

import { ensureCharacter, setLineSpeaker, type LineBlock } from "../model";
import { sampleStory } from "../testing/sample-story";
import { searchStory } from "./search";

const story = sampleStory();

describe("searchStory", () => {
  it("finds nothing for an empty query", () => {
    expect(searchStory(story, "  ")).toEqual([]);
  });

  it("finds phases by title and location", () => {
    expect(searchStory(story, "torni")[0]).toEqual(
      expect.objectContaining({ kind: "phase", number: "2", title: "Torni" }),
    );
    expect(searchStory(story, "kierreportaat")[0]).toEqual(
      expect.objectContaining({ kind: "phase", number: "2" }),
    );
  });

  it("finds cards by their text and dialogue", () => {
    const results = searchStory(story, "päiväkirjaa");
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(expect.objectContaining({ kind: "card", number: "1.2" }));
  });

  it("matches speakers, so a character's lines can be found by name", () => {
    expect(searchStory(story, "vartija").some((result) => result.number === "1.2")).toBe(true);
  });

  it("ignores case and accents", () => {
    const { story: withMother, entityId } = ensureCharacter(story, "Äiti");
    const line = withMother.phases[1]?.beats[0]?.blocks[1] as LineBlock;
    const next = setLineSpeaker(withMother, line.id, entityId);
    expect(searchStory(next, "aiti")[0]?.number).toBe("2.1");
  });

  it("marks where the match is in the excerpt", () => {
    const [result] = searchStory(story, "sumu");
    if (result === undefined) throw new Error("expected a result");
    const highlighted = result.excerpt.slice(
      result.matchStart,
      result.matchStart + result.matchLength,
    );
    expect(highlighted.toLowerCase()).toBe("sumu");
  });

  it("lists each card once and limits the results", () => {
    const results = searchStory(story, "a");
    const cards = results.filter((result) => result.kind === "card").map((r) => r.beatId);
    expect(new Set(cards).size).toBe(cards.length);
    expect(searchStory(story, "a", 2)).toHaveLength(2);
  });
});
