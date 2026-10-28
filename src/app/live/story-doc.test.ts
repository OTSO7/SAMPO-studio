import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  deletePhase,
  insertBeat,
  moveBeat,
  updateBeat,
  updateBlockText,
  type Story,
} from "@core/model";
import { deterministicIds, sampleStory } from "@core/testing/sample-story";
import { orderKeys, readStory, writeStory } from "./story-doc";

const ids = deterministicIds();
const base = sampleStory(ids);
const [first, second] = base.phases;
const card = first?.beats[0];
const block = card?.blocks[0];
if (first === undefined || second === undefined || card === undefined || block === undefined) {
  throw new Error("fixture changed");
}

/** Two people with the base story, each working offline until `exchange`. */
function pair() {
  const a = new Y.Doc();
  writeStory(a, null, base, "local");
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  return { a, b };
}

function exchange(a: Y.Doc, b: Y.Doc): void {
  const toB = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  const toA = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  Y.applyUpdate(b, toB);
  Y.applyUpdate(a, toA);
}

const edit = (doc: Y.Doc, change: (story: Story) => Story) =>
  writeStory(doc, base, change(base), "local");

const read = (doc: Y.Doc) => {
  const story = readStory(doc, null);
  if (story === null) throw new Error("empty document");
  return story;
};

describe("story as a shared document", () => {
  it("reads back what was written", () => {
    expect(read(pair().b)).toEqual(base);
  });

  it("keeps both people's edits to the same card", () => {
    const { a, b } = pair();
    edit(a, (s) => updateBeat(s, card.id, { label: "Labelled by A" }));
    edit(b, (s) => updateBlockText(s, block.id, "Typed by B"));
    exchange(a, b);

    const story = read(a);
    expect(story).toEqual(read(b));
    const merged = story.phases[0]?.beats[0];
    expect(merged?.label).toBe("Labelled by A");
    expect(merged?.blocks[0]).toMatchObject({ text: "Typed by B" });
  });

  it("keeps both cards added at the same spot, in the same order everywhere", () => {
    const { a, b } = pair();
    edit(a, (s) => insertBeat(s, first.id, 0, {}, ids).story);
    edit(b, (s) => insertBeat(s, first.id, 0, {}, ids).story);
    exchange(a, b);

    expect(read(a).phases[0]?.beats).toHaveLength(first.beats.length + 2);
    expect(read(a)).toEqual(read(b));
  });

  it("moves a card one person moved while the other edits it", () => {
    const { a, b } = pair();
    edit(a, (s) => moveBeat(s, card.id, second.id, 0));
    edit(b, (s) => updateBeat(s, card.id, { label: "Edited by B" }));
    exchange(a, b);

    const moved = read(a).phases[1]?.beats[0];
    expect(moved?.id).toBe(card.id);
    expect(moved?.label).toBe("Edited by B");
  });

  it("keeps a card added to a phase someone else deleted meanwhile", () => {
    const { a, b } = pair();
    edit(a, (s) => deletePhase(s, second.id));
    const added = insertBeat(base, second.id, 0, {}, ids);
    writeStory(b, base, added.story, "local");
    exchange(a, b);

    const story = read(a);
    expect(story.phases.some((p) => p.id === second.id)).toBe(false);
    expect(story.phases[0]?.beats.some((beat) => beat.id === added.beatId)).toBe(true);
  });

  it("keeps the objects of parts nobody changed", () => {
    const { a } = pair();
    const before = read(a);
    writeStory(a, before, updateBeat(before, card.id, { label: "New" }), "local");
    const after = readStory(a, before);

    expect(after?.phases[1]).toBe(before.phases[1]);
    expect(after?.phases[0]).not.toBe(before.phases[0]);
  });
});

describe("orderKeys", () => {
  it("keeps keys already in order and fills in the rest", () => {
    const keys = orderKeys(["a0", "a2", "a1", null]);
    expect(keys[0]).toBe("a0");
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(4);
  });
});
