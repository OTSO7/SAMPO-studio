import type { Block } from "./block";
import type { Entity } from "./entity";
import type { BeatId, CardTypeId, PhaseId, StoryId } from "./ids";
import type { Swatch } from "./palette";

/**
 * A kind of card the author defines for their own story: "Scene", "Gameplay", "Boss fight",
 * "Flashback". Every story has at least one; the first is the default for new cards.
 */
export interface CardType {
  readonly id: CardTypeId;
  readonly name: string;
  readonly color: Swatch;
}

/** Perceived tension on a 0–5 scale. */
export type Intensity = 0 | 1 | 2 | 3 | 4 | 5;

/** How far a card is: being written, waiting for the team, or locked for recording. */
export const BEAT_STATUSES = ["draft", "review", "final"] as const;
export type BeatStatus = (typeof BEAT_STATUSES)[number];

/** One card on the board: a moment, a scene, a conversation. */
export interface Beat {
  readonly id: BeatId;
  readonly typeId: CardTypeId;
  /** The author's own heading for the card. */
  readonly label?: string;
  readonly intensity?: Intensity;
  /** Left out while the card is a draft, the state every card starts in. */
  readonly status?: Exclude<BeatStatus, "draft">;
  readonly blocks: readonly Block[];
}

/**
 * A column on the board: a chapter, act or level. Phases are numbered by their position in
 * `Story.phases`, so reordering never leaves stale numbers behind.
 */
export interface Phase {
  readonly id: PhaseId;
  readonly title: string;
  readonly location?: string;
  readonly beats: readonly Beat[];
}

export interface Story {
  readonly id: StoryId;
  readonly title: string;
  readonly cardTypes: readonly CardType[];
  readonly phases: readonly Phase[];
  readonly entities: readonly Entity[];
}
