import { describe, expect, it } from "vitest";

import { setLineDirection, type BeatId, type BlockId, type LineBlock } from "../model";
import { sampleStory } from "../testing/sample-story";
import { storyToMarkdown } from "./script-markdown";
import { collectVoiceLines, estimateSeconds, voiceLineId, voiceLinesToCsv } from "./voice-lines";

const story = sampleStory();

describe("collectVoiceLines", () => {
  it("lists every line in story order with its place in the story", () => {
    const lines = collectVoiceLines(story);
    expect(lines.map((line) => [line.character, line.text, line.card])).toEqual([
      ["Vartija", "Valo ei sammunut itsestään.", "1.2"],
      ["Mirja", "Tämä ei ole sama torni.", "2.1"],
    ]);
    expect(lines[0]?.phase).toBe("1. Saapuminen");
  });

  it("keeps ids stable when cards are reordered", () => {
    const before = collectVoiceLines(story).map((line) => line.id);
    const reordered = { ...story, phases: [...story.phases].reverse() };
    const after = collectVoiceLines(reordered).map((line) => line.id);
    expect([...after].reverse()).toEqual(before);
  });

  it("includes the direction", () => {
    const line = story.phases[0]?.beats[1]?.blocks[1] as LineBlock;
    const withDirection = setLineDirection(story, line.id, "kuiskaten");
    expect(collectVoiceLines(withDirection)[0]?.direction).toBe("kuiskaten");
  });
});

describe("voiceLineId", () => {
  it("builds a readable id from the speaker and the line id", () => {
    expect(voiceLineId("Musta Routa", "bk_01JB3Z8Q4M6V2N7KXW9R0T5H1C")).toBe("VO_MUSTA_ROUTA_5H1C");
    expect(voiceLineId("Äiti", "bk_x1y2")).toBe("VO_AITI_X1Y2");
    expect(voiceLineId("", "bk_abcd")).toBe("VO_UNASSIGNED_ABCD");
  });
});

describe("estimateSeconds", () => {
  it("estimates at 2.5 words a second, at least one second", () => {
    expect(estimateSeconds("")).toBe(0);
    expect(estimateSeconds("Hei")).toBe(1);
    expect(estimateSeconds("yksi kaksi kolme neljä viisi")).toBe(2);
  });
});

describe("voiceLinesToCsv", () => {
  it("writes a header and quotes cells that need it", () => {
    const csv = voiceLinesToCsv([
      {
        id: "VO_A_0001",
        blockId: "bk_a" as BlockId,
        beatId: "bt_a" as BeatId,
        speaker: null,
        character: "A",
        text: 'Hän sanoi "ei", ja lähti.\nHiljaisuus.',
        direction: "",
        phase: "1. Alku",
        card: "1.1",
        heading: "",
        seconds: 2,
      },
    ]);
    expect(
      csv.startsWith("\uFEFFID,Character,Line,Direction,Seconds,Card,Card heading,Phase\r\n"),
    ).toBe(true);
    expect(csv).toContain(
      'VO_A_0001,A,"Hän sanoi ""ei"", ja lähti.\nHiljaisuus.",,2,1.1,,1. Alku\r\n',
    );
  });
});

describe("storyToMarkdown", () => {
  it("renders phases, numbered cards and dialogue", () => {
    const markdown = storyToMarkdown(story);
    expect(markdown).toContain("# Majakka\n");
    expect(markdown).toContain("## 01 Saapuminen\n\n*Majakkasaari*\n");
    expect(markdown).toContain("### 1.2\n");
    expect(markdown).toContain("**VARTIJA**  \nValo ei sammunut itsestään.\n");
  });

  it("leaves notes out unless asked", () => {
    expect(storyToMarkdown(story)).not.toContain("Kuuluuko tässä sade?");
    expect(storyToMarkdown(story, { includeNotes: true })).toContain(
      "> Note: Kuuluuko tässä sade?",
    );
  });
});
