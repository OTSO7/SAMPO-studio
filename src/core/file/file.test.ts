import { describe, expect, it } from "vitest";

import { createIdFactory, type IdSource, type Story } from "../model";
import lighthouse from "../parse/__fixtures__/lighthouse.txt?raw";
import { parsePlainText } from "../parse";
import { deserializeStory } from "./deserialize";
import { CURRENT_VERSION, FORMAT_ID } from "./format";
import { serializeStory } from "./serialize";

function deterministicIds() {
  let time = 0;
  const source: IdSource = { now: () => time++, fillRandom: (bytes) => bytes.fill(0) };
  return createIdFactory(source);
}

function sampleStory(): Story {
  const story = parsePlainText(lighthouse, { title: "Majakka", ids: deterministicIds() });
  // Exercise the optional fields the parser never produces.
  const [phase] = story.phases;
  const [beat] = phase?.beats ?? [];
  if (phase === undefined || beat === undefined) throw new Error("fixture changed");

  return {
    ...story,
    entities: story.entities.map((entity, i) =>
      i === 0 ? { ...entity, description: "Majakan entinen vartija." } : entity,
    ),
    phases: [
      {
        ...phase,
        beats: [
          {
            ...beat,
            intensity: 3,
            blocks: [
              ...beat.blocks,
              { type: "note", id: deterministicIds().block(), kind: "question", text: "Sade?" },
            ],
          },
          ...phase.beats.slice(1),
        ],
      },
      ...story.phases.slice(1),
    ],
  };
}

/** Round-trips the story through the file format and parses the raw JSON for tampering. */
function rawFile(story: Story = sampleStory()) {
  return JSON.parse(serializeStory(story)) as {
    format: string;
    version: number;
    story: Record<string, unknown> & {
      entities: Record<string, unknown>[];
      phases: (Record<string, unknown> & {
        beats: (Record<string, unknown> & { blocks: Record<string, unknown>[] })[];
      })[];
    };
  };
}

function load(file: unknown) {
  return deserializeStory(JSON.stringify(file));
}

describe("serializeStory", () => {
  it("writes a versioned, human-readable JSON file", () => {
    const text = serializeStory(sampleStory());
    expect(
      text.startsWith(`{\n  "format": "${FORMAT_ID}",\n  "version": ${CURRENT_VERSION},`),
    ).toBe(true);
    expect(text.endsWith("}\n")).toBe(true);
  });

  it("is deterministic", () => {
    const story = sampleStory();
    expect(serializeStory(story)).toBe(serializeStory(story));
  });

  it("records the save time only when asked to", () => {
    expect(rawFile()).not.toHaveProperty("savedAt");
    const text = serializeStory(sampleStory(), { savedAt: "2026-10-21T10:00:00.000Z" });
    expect(JSON.parse(text)).toHaveProperty("savedAt", "2026-10-21T10:00:00.000Z");
  });

  it("omits optional fields that are not set", () => {
    const [, second] = rawFile().story.phases;
    expect(second?.beats[0]).not.toHaveProperty("intensity");
  });
});

describe("deserializeStory", () => {
  it("restores exactly what was saved", () => {
    const story = sampleStory();
    expect(deserializeStory(serializeStory(story))).toEqual({ ok: true, story });
  });

  it("survives a save, load, save cycle byte for byte", () => {
    const first = serializeStory(sampleStory());
    const loaded = deserializeStory(first);
    if (!loaded.ok) throw new Error(loaded.errors.join("\n"));
    expect(serializeStory(loaded.story)).toBe(first);
  });

  it("rejects text that is not JSON", () => {
    const result = deserializeStory("{ not json");
    expect(result.ok).toBe(false);
  });

  it("rejects JSON from other programs", () => {
    expect(load({ hello: "world" })).toEqual({
      ok: false,
      errors: ["This is not a SAMPO story file."],
    });
  });

  it("refuses files from a newer version instead of guessing", () => {
    const file = rawFile();
    file.version = CURRENT_VERSION + 1;
    const result = load(file);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]).toMatch(/newer version of SAMPO/u);
  });

  it("reports every problem with its location", () => {
    const file = rawFile();
    const phase = file.story.phases[0];
    const beat = phase?.beats[0];
    if (phase === undefined || beat === undefined) throw new Error("fixture changed");

    phase["title"] = 42;
    beat["kind"] = "cutscene";
    beat["intensity"] = 9;

    const result = load(file);
    expect(result).toEqual({
      ok: false,
      errors: [
        "story.phases[0].title: expected a string",
        "story.phases[0].beats[0].kind: expected one of narrative, mechanic, shift, insight",
        "story.phases[0].beats[0].intensity: expected an integer between 0 and 5",
      ],
    });
  });

  it("rejects malformed ids", () => {
    const file = rawFile();
    file.story["id"] = "bt_not-a-story-id";
    const result = load(file);
    expect(result).toEqual({ ok: false, errors: ["story.id: expected a story id"] });
  });

  it("detects duplicate ids", () => {
    const file = rawFile();
    const [first, second] = file.story.phases;
    if (first === undefined || second === undefined) throw new Error("fixture changed");
    second["id"] = first["id"];

    const result = load(file);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]).toMatch(/^story\.phases\[1\]\.id: duplicate id/u);
  });

  it("detects lines spoken by entities that do not exist", () => {
    const file = rawFile();
    file.story.entities = [];

    const result = load(file);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.every((error) => /unknown entity/u.test(error))).toBe(true);
  });
});
