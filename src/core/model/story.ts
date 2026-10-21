import type { Block } from "./block";
import type { Entity } from "./entity";
import type { BeatId, PhaseId, StoryId } from "./ids";

/**
 * What a beat is for. Lenses use this to filter: the mechanics lens shows `mechanic` beats,
 * the story lens shows everything.
 */
export const BEAT_KINDS = ["narrative", "mechanic", "shift", "insight"] as const;
export type BeatKind = (typeof BEAT_KINDS)[number];

/** Perceived tension on a 0–5 scale, plotted by the tension lens. */
export type Intensity = 0 | 1 | 2 | 3 | 4 | 5;

/** One moment within a phase, e.g. "Tutkinta" or "The Shift". */
export interface Beat {
  readonly id: BeatId;
  readonly kind: BeatKind;
  /** The author's own heading for the beat, if the source text had one. */
  readonly label?: string;
  readonly intensity?: Intensity;
  readonly blocks: readonly Block[];
}

/**
 * A chapter-sized unit of the story. Phases are numbered by their position in
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
  readonly phases: readonly Phase[];
  readonly entities: readonly Entity[];
}
