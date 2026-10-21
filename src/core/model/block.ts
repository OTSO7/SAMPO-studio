import type { BlockId, EntityId } from "./ids";

/** Prose describing what happens on screen. */
export interface ActionBlock {
  readonly type: "action";
  readonly id: BlockId;
  readonly text: string;
}

/** A spoken or recorded line. */
export interface LineBlock {
  readonly type: "line";
  readonly id: BlockId;
  /** `null` when the speaker has not been identified yet. */
  readonly speaker: EntityId | null;
  readonly text: string;
  /** Delivery note for the actor, e.g. "hengästyneenä". */
  readonly direction?: string;
}

export const NOTE_KINDS = ["idea", "question"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

/** Work-in-progress thinking. Never part of the canon and never exported to the game. */
export interface NoteBlock {
  readonly type: "note";
  readonly id: BlockId;
  readonly kind: NoteKind;
  readonly text: string;
}

export type Block = ActionBlock | LineBlock | NoteBlock;
export type BlockType = Block["type"];
