import {
  defaultCardType,
  findCardType,
  insertBeat,
  type BeatId,
  type PhaseId,
  type Story,
} from "@core/model";

export type InsertKind = "card" | "dialogue";

/** A plain card, or a dialogue card of the story's "Dialogue" type with one empty line. */
export function insertCard(
  story: Story,
  phaseId: PhaseId,
  index: number,
  kind: InsertKind,
): { story: Story; beatId: BeatId | null } {
  if (kind === "card") return insertBeat(story, phaseId, index);
  return insertBeat(story, phaseId, index, {
    typeId: (findCardType(story, "Dialogue") ?? defaultCardType(story)).id,
    blocks: [{ type: "line", speaker: null }],
  });
}
