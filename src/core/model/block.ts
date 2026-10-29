import type { BlockId, EntityId } from "./ids";
import type { Story } from "./story";

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
  /** A recording of the line, scratch or final, as a `media:` reference. */
  readonly take?: string;
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

/** A picture on the card: concept art, a reference photo, a storyboard frame. */
export interface ImageBlock {
  readonly type: "image";
  readonly id: BlockId;
  /**
   * A `media:` reference to a file packed into the story. Stories from before packages hold
   * the picture inline as a data URL instead.
   */
  readonly src: string;
  /** Caption shown under the picture. */
  readonly text: string;
}

/** A sound on the card: mood music, an ambience, a reference effect. */
export interface AudioBlock {
  readonly type: "audio";
  readonly id: BlockId;
  /** A `media:` reference to a file packed into the story. */
  readonly src: string;
  readonly text: string;
  /**
   * Music (absent, the default) plays one track at a time with a full player. `"sfx"` is an
   * effect, a soundboard pad that can be hit again and again, each hit starting it over.
   * Absent rather than `"music"`, so files stay as older versions wrote and read them.
   */
  readonly role?: SoundRole;
}

export type SoundRole = "sfx";

export type Block = ActionBlock | LineBlock | NoteBlock | ImageBlock | AudioBlock;
export type BlockType = Block["type"];
/** Blocks that are written rather than pictured or heard; these turn into one another. */
export type TextBlockType = Exclude<BlockType, "image" | "audio">;
export type MediaBlock = ImageBlock | AudioBlock;

const MEDIA_PREFIX = "media:";
const HASHED_NAME = /^[0-9a-f]{64}\.[a-z0-9]{2,5}$/u;

/** `media:3fa9…c2.webp`: how blocks point at a picture or sound packed into the story. */
export function mediaRef(id: string): string {
  return `${MEDIA_PREFIX}${id}`;
}

/** The packed file's name, or `null` for anything else, such as a legacy data URL. */
export function mediaIdOf(src: string): string | null {
  if (!src.startsWith(MEDIA_PREFIX)) return null;
  const id = src.slice(MEDIA_PREFIX.length);
  return HASHED_NAME.test(id) ? id : null;
}

/** Every packed file the story uses, once each: what a save has to put in the package. */
export function storyMediaIds(story: Story): string[] {
  const ids = new Set<string>();
  for (const phase of story.phases) {
    for (const beat of phase.beats) {
      for (const block of beat.blocks) {
        const src =
          block.type === "image" || block.type === "audio"
            ? block.src
            : block.type === "line"
              ? block.take
              : undefined;
        const id = src === undefined ? null : mediaIdOf(src);
        if (id !== null) ids.add(id);
      }
    }
  }
  return [...ids];
}
