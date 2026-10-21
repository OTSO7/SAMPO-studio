import { describe, expect, it } from "vitest";

import type { LineBlock } from "../model";
import { deterministicIds, sampleStory } from "../testing/sample-story";
import { assembleStory, UNTITLED_PHASE } from "./assemble";

const ids = deterministicIds;

describe("assembleStory", () => {
  const story = sampleStory();

  it("builds phases with titles and locations", () => {
    expect(story.title).toBe("Majakka");
    expect(story.phases.map((phase) => [phase.title, phase.location])).toEqual([
      ["Saapuminen", "Majakkasaari"],
      ["Torni", "Kierreportaat"],
    ]);
  });

  it("starts a beat at every beat row and appends following rows to it", () => {
    const [first] = story.phases;
    expect(first?.beats.map((beat) => beat.blocks.map((block) => block.type))).toEqual([
      ["action", "action"],
      ["action", "line"],
    ]);
  });

  it("turns speakers into characters, once per name", () => {
    expect(story.entities.map((entity) => [entity.kind, entity.name])).toEqual([
      ["character", "Vartija"],
      ["character", "Mirja"],
    ]);
  });

  it("strips quotes around spoken lines", () => {
    const line = story.phases[0]?.beats[1]?.blocks[1] as LineBlock;
    expect(line.text).toBe("Valo ei sammunut itsestään.");
  });

  it("keeps notes as non-canon blocks", () => {
    expect(story.phases[1]?.beats[0]?.blocks.at(-1)).toEqual(
      expect.objectContaining({ type: "note", kind: "idea", text: "Kuuluuko tässä sade?" }),
    );
  });

  it("creates a phase and beat on demand so unmarked text is never lost", () => {
    const loose = assembleStory([{ role: "text", text: "Alkusanat." }], ids());
    expect(loose.phases[0]?.title).toBe(UNTITLED_PHASE);
    expect(loose.phases[0]?.beats[0]?.blocks).toEqual([
      expect.objectContaining({ type: "action", text: "Alkusanat." }),
    ]);
  });

  it("leaves skipped rows out", () => {
    const result = assembleStory(
      [
        { role: "phase", text: "Alku" },
        { role: "skip", text: "Pelitapahtumat:" },
      ],
      ids(),
    );
    expect(result.phases[0]?.beats).toEqual([]);
  });

  it("matches speakers regardless of case and keeps lines without a speaker", () => {
    const result = assembleStory(
      [
        { role: "line", speaker: "Elias", text: "Yksi." },
        { role: "line", speaker: "ELIAS", text: "Kaksi." },
        { role: "line", text: "Kolme." },
      ],
      ids(),
    );
    const lines = result.phases[0]?.beats[0]?.blocks as LineBlock[];
    expect(lines[0]?.speaker).toBe(lines[1]?.speaker);
    expect(lines[2]?.speaker).toBeNull();
    expect(result.entities).toHaveLength(1);
  });

  it("returns an empty untitled story for no rows", () => {
    const empty = assembleStory([], ids());
    expect(empty.title).toBe("Untitled");
    expect(empty.phases).toEqual([]);
  });
});
