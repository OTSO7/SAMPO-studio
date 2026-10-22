import { describe, expect, it } from "vitest";

import { addCardType, setLineDirection, updateBeat, type LineBlock, type Story } from "../model";
import { deterministicIds, sampleStory as baseStory } from "../testing/sample-story";
import { deserializeStory } from "./deserialize";
import { CURRENT_VERSION, FORMAT_ID } from "./format";
import { serializeStory } from "./serialize";

function baseSample(): Story {
  const story = baseStory();
  // Exercise the optional fields an import never produces.
  const [phase] = story.phases;
  const [beat] = phase?.beats ?? [];
  if (phase === undefined || beat === undefined) throw new Error("fixture changed");
  const ids = deterministicIds();

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
              { type: "note", id: ids.block(), kind: "question", text: "Sade?" },
              {
                type: "image",
                id: ids.block(),
                src: "data:image/webp;base64,UklGRg==",
                text: "Yö",
              },
            ],
          },
          ...phase.beats.slice(1),
        ],
      },
      ...story.phases.slice(1),
    ],
  };
}

/** The base sample plus every optional field format 2 can hold. */
function sampleStory(): Story {
  const base = baseSample();
  const beat = base.phases[0]?.beats[1];
  const line = beat?.blocks.find((block): block is LineBlock => block.type === "line");
  if (beat === undefined || line === undefined) throw new Error("fixture changed");

  const { story: withType, typeId } = addCardType(base, "Boss fight", deterministicIds());
  return setLineDirection(updateBeat(withType, beat.id, { typeId }), line.id, "kuiskaten");
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

  it("only accepts pictures embedded in the file", () => {
    const file = rawFile();
    const image = file.story.phases[0]?.beats[0]?.blocks.find((block) => block["type"] === "image");
    if (image === undefined) throw new Error("fixture changed");
    image["src"] = "C:/Users/me/kuva.png";

    const result = load(file);

    expect(!result.ok && result.errors).toEqual([
      "story.phases[0].beats[0].blocks[3].src: expected an embedded image",
    ]);
  });

  it("opens version 2 files, which had no pictures, unchanged", () => {
    const story = baseStory();
    const file = rawFile(story);
    file.version = 2;

    expect(load(file)).toEqual({ ok: true, story });
  });

  it("reports every problem with its location", () => {
    const file = rawFile();
    const phase = file.story.phases[0];
    const beat = phase?.beats[0];
    if (phase === undefined || beat === undefined) throw new Error("fixture changed");

    phase["title"] = 42;
    beat["typeId"] = "ct_nope";
    beat["intensity"] = 9;

    const result = load(file);
    expect(result).toEqual({
      ok: false,
      errors: [
        "story.phases[0].title: expected a string",
        "story.phases[0].beats[0].typeId: expected a cardType id",
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

  it("rejects cards whose type does not exist", () => {
    const file = rawFile();
    file.story["cardTypes"] = (file.story["cardTypes"] as unknown[]).slice(1);
    const result = load(file);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]).toMatch(/typeId: unknown card type/u);
  });

  it("upgrades version 1 files with fixed beat kinds", () => {
    const v1 = {
      format: FORMAT_ID,
      version: 1,
      story: {
        id: "st_01JB3Z8Q4M6V2N7KXW9R0T5H1C",
        title: "Vanha",
        entities: [],
        phases: [
          {
            id: "ph_01JB3Z8Q4M6V2N7KXW9R0T5H1D",
            title: "Alku",
            beats: [
              { id: "bt_01JB3Z8Q4M6V2N7KXW9R0T5H1E", kind: "mechanic", blocks: [] },
              { id: "bt_01JB3Z8Q4M6V2N7KXW9R0T5H1F", kind: "narrative", blocks: [] },
            ],
          },
        ],
      },
    };

    const result = load(v1);
    if (!result.ok) throw new Error(result.errors.join("\n"));

    const typeName = (id: string) => result.story.cardTypes.find((type) => type.id === id)?.name;
    const beats = result.story.phases[0]?.beats ?? [];
    expect(beats.map((beat) => typeName(beat.typeId))).toEqual(["Gameplay", "Scene"]);
  });

  it("keeps every format 2 field through a save and load", () => {
    const story = sampleStory();
    const loaded = deserializeStory(serializeStory(story));
    if (!loaded.ok) throw new Error(loaded.errors.join("\n"));

    expect(loaded.story.cardTypes.at(-1)?.name).toBe("Boss fight");
    expect(loaded.story.entities.every((entity) => entity.color !== undefined)).toBe(true);
    const beat = loaded.story.phases[0]?.beats[1];
    expect(beat?.typeId).toBe(loaded.story.cardTypes.at(-1)?.id);
    expect(beat?.blocks.find((block) => block.type === "line")).toEqual(
      expect.objectContaining({ direction: "kuiskaten" }),
    );
  });
});
