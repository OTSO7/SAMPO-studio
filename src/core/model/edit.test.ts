import { describe, expect, it } from "vitest";

import { deterministicIds, sampleStory } from "../testing/sample-story";
import {
  addBlock,
  addCardType,
  addPhase,
  deleteBeat,
  deletePhase,
  ensureCharacter,
  findBeat,
  insertBeat,
  mergeBeatWithPrevious,
  mergePhaseWithPrevious,
  moveBeat,
  NEW_PHASE_TITLE,
  moveCardType,
  removeBlock,
  removeCardType,
  removeEntity,
  setBlockType,
  setLineDirection,
  setLineSpeaker,
  splitPhaseAt,
  updateBeat,
  updateBlockText,
  updatePhase,
} from "./edit";
import type { BeatId, PhaseId, Story } from "./index";

const story = sampleStory();
const [first, second] = story.phases;
if (first === undefined || second === undefined) throw new Error("fixture changed");
const [b1, b2] = first.beats;
const [b3] = second.beats;
if (b1 === undefined || b2 === undefined || b3 === undefined) throw new Error("fixture changed");

const beatIds = (s: Story) => s.phases.map((phase) => phase.beats.map((beat) => beat.id));

describe("updatePhase", () => {
  it("renames and relocates a phase", () => {
    const next = updatePhase(story, first.id, { title: "Alku", location: "Laituri" });
    expect(next.phases[0]).toEqual(expect.objectContaining({ title: "Alku", location: "Laituri" }));
  });

  it("removes the location when cleared", () => {
    expect(updatePhase(story, first.id, { location: " " }).phases[0]).not.toHaveProperty(
      "location",
    );
  });
});

describe("updateBeat", () => {
  const gameplay = story.cardTypes[2];
  if (gameplay === undefined) throw new Error("fixture changed");

  it("sets type, label and intensity", () => {
    const next = updateBeat(story, b1.id, { typeId: gameplay.id, label: "Minipeli", intensity: 4 });
    expect(findBeat(next, b1.id)?.beat).toEqual(
      expect.objectContaining({ typeId: gameplay.id, label: "Minipeli", intensity: 4 }),
    );
  });

  it("removes label and intensity", () => {
    const set = updateBeat(story, b1.id, { label: "X", intensity: 2 });
    const cleared = updateBeat(set, b1.id, { label: "", intensity: null });
    expect(findBeat(cleared, b1.id)?.beat).not.toHaveProperty("label");
    expect(findBeat(cleared, b1.id)?.beat).not.toHaveProperty("intensity");
  });

  it("does not touch the input story", () => {
    const before = b1.typeId;
    updateBeat(story, b1.id, { typeId: gameplay.id });
    expect(b1.typeId).toBe(before);
  });
});

describe("updateBlockText", () => {
  it("edits one block's text", () => {
    const block = b1.blocks[0];
    if (block === undefined) throw new Error("fixture changed");
    const next = updateBlockText(story, block.id, "Uusi teksti.");
    expect(findBeat(next, b1.id)?.beat.blocks[0]?.text).toBe("Uusi teksti.");
  });
});

describe("moveBeat", () => {
  it("reorders within a phase", () => {
    expect(beatIds(moveBeat(story, b1.id, first.id, 1))[0]).toEqual([b2.id, b1.id]);
  });

  it("moves across phases", () => {
    const next = moveBeat(story, b1.id, second.id, 0);
    expect(beatIds(next)).toEqual([[b2.id], [b1.id, b3.id]]);
  });

  it("clamps the index and ignores unknown targets", () => {
    expect(beatIds(moveBeat(story, b1.id, second.id, 99))[1]).toEqual([b3.id, b1.id]);
    expect(moveBeat(story, "bt_x" as BeatId, second.id, 0)).toBe(story);
  });
});

describe("splitPhaseAt", () => {
  it("moves the beat and everything after it into a new phase", () => {
    const next = splitPhaseAt(story, b2.id, deterministicIds());
    expect(next.phases.map((phase) => phase.title)).toEqual([
      first.title,
      NEW_PHASE_TITLE,
      second.title,
    ]);
    expect(beatIds(next)).toEqual([[b1.id], [b2.id], [b3.id]]);
  });

  it("does nothing at the first beat of a phase", () => {
    expect(splitPhaseAt(story, b1.id)).toBe(story);
  });
});

describe("mergePhaseWithPrevious", () => {
  it("joins two phases", () => {
    const next = mergePhaseWithPrevious(story, second.id);
    expect(beatIds(next)).toEqual([[b1.id, b2.id, b3.id]]);
    expect(next.phases[0]?.title).toBe(first.title);
  });

  it("undoes a split", () => {
    const split = splitPhaseAt(story, b2.id);
    const newPhase = split.phases[1];
    if (newPhase === undefined) throw new Error("expected a new phase");
    expect(beatIds(mergePhaseWithPrevious(split, newPhase.id))).toEqual(beatIds(story));
  });
});

describe("mergeBeatWithPrevious", () => {
  it("appends the blocks to the previous beat", () => {
    const next = mergeBeatWithPrevious(story, b2.id);
    expect(beatIds(next)[0]).toEqual([b1.id]);
    expect(findBeat(next, b1.id)?.beat.blocks).toEqual([...b1.blocks, ...b2.blocks]);
  });

  it("does nothing for the first beat", () => {
    expect(mergeBeatWithPrevious(story, b1.id)).toBe(story);
  });
});

describe("adding and deleting", () => {
  it("deletes a beat", () => {
    expect(beatIds(deleteBeat(story, b1.id))[0]).toEqual([b2.id]);
  });

  it("inserts a card at a position with the default type and an empty text block", () => {
    const { story: next, beatId } = insertBeat(story, first.id, 1);
    expect(beatId).not.toBeNull();
    expect(beatIds(next)[0]).toEqual([b1.id, beatId, b2.id]);
    const created = beatId === null ? null : findBeat(next, beatId)?.beat;
    expect(created?.typeId).toBe(story.cardTypes[0]?.id);
    expect(created?.blocks).toEqual([expect.objectContaining({ type: "action", text: "" })]);
  });

  it("inserts a dialogue card with its own type and blocks", () => {
    const dialogue = story.cardTypes[1];
    if (dialogue === undefined) throw new Error("fixture changed");
    const { story: next, beatId } = insertBeat(story, second.id, undefined, {
      typeId: dialogue.id,
      blocks: [{ type: "line", speaker: null }],
    });
    const created = beatId === null ? null : findBeat(next, beatId)?.beat;
    expect(beatIds(next)[1]).toEqual([b3.id, beatId]);
    expect(created?.typeId).toBe(dialogue.id);
    expect(created?.blocks).toEqual([expect.objectContaining({ type: "line", speaker: null })]);
  });

  it("adds an empty phase at the end", () => {
    expect(addPhase(story).phases.at(-1)).toEqual(
      expect.objectContaining({ title: NEW_PHASE_TITLE, beats: [] }),
    );
  });
});

describe("blocks", () => {
  const types = (s: Story) => findBeat(s, b1.id)?.beat.blocks.map((block) => block.type);

  it("inserts a block at a position", () => {
    const { story: next, blockId } = addBlock(story, b1.id, { type: "line", speaker: null }, 1);
    expect(types(next)).toEqual(["action", "line", "action"]);
    expect(findBeat(next, b1.id)?.beat.blocks[1]?.id).toBe(blockId);
  });

  it("appends by default and ignores unknown beats", () => {
    expect(types(addBlock(story, b1.id, { type: "note" }).story)).toEqual([
      "action",
      "action",
      "note",
    ]);
    expect(addBlock(story, "bt_x" as BeatId, { type: "note" }).blockId).toBeNull();
  });

  it("removes a block", () => {
    const first = b1.blocks[0];
    if (first === undefined) throw new Error("fixture changed");
    expect(types(removeBlock(story, first.id))).toEqual(["action"]);
  });

  it("changes a block's type and keeps its text", () => {
    const first = b1.blocks[0];
    if (first === undefined) throw new Error("fixture changed");
    const asLine = setBlockType(story, first.id, "line");
    expect(findBeat(asLine, b1.id)?.beat.blocks[0]).toEqual({
      type: "line",
      id: first.id,
      speaker: null,
      text: first.text,
    });
    expect(setBlockType(asLine, first.id, "action")).toEqual(story);
  });

  it("sets who speaks a line", () => {
    const line = b2.blocks[1];
    const mirja = story.entities[1];
    if (line === undefined || mirja === undefined) throw new Error("fixture changed");
    const next = setLineSpeaker(story, line.id, mirja.id);
    expect(findBeat(next, b2.id)?.beat.blocks[1]).toEqual(
      expect.objectContaining({ speaker: mirja.id }),
    );
  });
});

describe("ensureCharacter", () => {
  it("returns an existing character regardless of case", () => {
    const result = ensureCharacter(story, " mirja ");
    expect(result.story).toBe(story);
    expect(result.entityId).toBe(story.entities[1]?.id);
  });

  it("adds a new character", () => {
    const result = ensureCharacter(story, "Musta Routa");
    expect(result.story.entities.at(-1)).toEqual(
      expect.objectContaining({ id: result.entityId, kind: "character", name: "Musta Routa" }),
    );
  });
});

describe("setLineDirection", () => {
  const line = b2.blocks[1];
  if (line === undefined) throw new Error("fixture changed");

  it("sets and clears a delivery note", () => {
    const set = setLineDirection(story, line.id, "whispering");
    expect(findBeat(set, b2.id)?.beat.blocks[1]).toEqual(
      expect.objectContaining({ direction: "whispering" }),
    );
    expect(findBeat(setLineDirection(set, line.id, ""), b2.id)?.beat.blocks[1]).not.toHaveProperty(
      "direction",
    );
  });
});

describe("characters", () => {
  it("gives each new character a different colour", () => {
    const colors = story.entities.map((entity) => entity.color);
    expect(new Set(colors).size).toBe(colors.length);
    expect(ensureCharacter(story, "Kolmas").story.entities.at(-1)?.color).not.toBe(colors[0]);
  });

  it("removes a character and keeps their lines unattributed", () => {
    const mirja = story.entities[1];
    if (mirja === undefined) throw new Error("fixture changed");
    const next = removeEntity(story, mirja.id);
    expect(next.entities.map((entity) => entity.id)).not.toContain(mirja.id);
    const lines = next.phases
      .flatMap((phase) => phase.beats)
      .flatMap((beat) => beat.blocks)
      .filter((block) => block.type === "line");
    expect(lines.every((block) => block.speaker !== mirja.id)).toBe(true);
    expect(lines).toHaveLength(2);
  });
});

describe("card types", () => {
  it("starts every story with a neutral default set", () => {
    expect(story.cardTypes.map((type) => type.name)).toEqual([
      "Scene",
      "Dialogue",
      "Gameplay",
      "Cutscene",
      "Reveal",
    ]);
  });

  it("adds a type with an unused colour", () => {
    const { story: next, typeId } = addCardType(story, " Boss fight ");
    const added = next.cardTypes.at(-1);
    expect(added).toEqual(expect.objectContaining({ id: typeId, name: "Boss fight" }));
    expect(story.cardTypes.map((type) => type.color)).not.toContain(added?.color);
  });

  it("moves cards to the first remaining type when their type is removed", () => {
    const scene = story.cardTypes[0];
    const reveal = story.cardTypes[4];
    if (scene === undefined || reveal === undefined) throw new Error("fixture changed");
    const tagged = updateBeat(story, b1.id, { typeId: reveal.id });

    const next = removeCardType(tagged, reveal.id);

    expect(next.cardTypes).toHaveLength(4);
    expect(findBeat(next, b1.id)?.beat.typeId).toBe(scene.id);
  });

  it("never removes the last type", () => {
    const only = { ...story, cardTypes: story.cardTypes.slice(0, 1) };
    const type = only.cardTypes[0];
    if (type === undefined) throw new Error("fixture changed");
    expect(removeCardType(only, type.id)).toBe(only);
  });

  it("reorders types", () => {
    const dialogue = story.cardTypes[1];
    if (dialogue === undefined) throw new Error("fixture changed");
    expect(moveCardType(story, dialogue.id, -1).cardTypes[0]?.id).toBe(dialogue.id);
    expect(moveCardType(story, dialogue.id, -1).cardTypes).toHaveLength(5);
  });
});

describe("deletePhase", () => {
  it("removes the phase with its cards and moves the rest up", () => {
    const next = deletePhase(story, first.id);
    expect(next.phases.map((phase) => phase.id)).toEqual([second.id]);
    expect(findBeat(next, b1.id)).toBeNull();
  });

  it("ignores unknown phases", () => {
    expect(deletePhase(story, "ph_x" as PhaseId)).toBe(story);
  });
});
