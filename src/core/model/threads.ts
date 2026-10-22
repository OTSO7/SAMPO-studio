import type { Entity } from "./entity";
import type { BeatId } from "./ids";
import type { Story } from "./story";

/** One story thread and the cards it runs through, in story order. */
export interface ThreadRun {
  readonly thread: Entity;
  readonly cards: readonly { readonly beatId: BeatId; readonly number: string }[];
}

/**
 * Every thread with the cards pinned to it. The first card sets the thread up, the last pays
 * it off; a thread on a single card is still open, the dangling clue an author wants to see.
 * A thread just started on the board has no cards yet.
 */
export function threadRuns(story: Story): ThreadRun[] {
  return story.entities
    .filter((entity) => entity.kind === "thread")
    .map((thread) => ({
      thread,
      cards: story.phases.flatMap((phase, phaseIndex) =>
        phase.beats.flatMap((beat, beatIndex) =>
          beat.threads?.includes(thread.id) === true
            ? [{ beatId: beat.id, number: `${phaseIndex + 1}.${beatIndex + 1}` }]
            : [],
        ),
      ),
    }));
}
