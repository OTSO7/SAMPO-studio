import type { EntityId } from "./ids";
import type { Swatch } from "./palette";

/**
 * A `thread` is a story thread the author follows across cards: a clue, a mystery, a promise
 * the story has to keep, such as "the key" or "who put out the light".
 */
export const ENTITY_KINDS = ["character", "location", "prop", "thread"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/**
 * Something the story keeps referring to: a character, a place, an object or a thread. Blocks
 * and cards point at entities by id, so renaming "Lyhty" to "Retkilyhty" happens in one place.
 */
export interface Entity {
  readonly id: EntityId;
  readonly kind: EntityKind;
  readonly name: string;
  /** Other spellings the parser should recognise, e.g. inflected Finnish forms. */
  readonly aliases: readonly string[];
  readonly description?: string;
  /** Used to tell speakers apart in dialogue. */
  readonly color?: Swatch;
  /** Who voices the character, so recording sessions can be booked per actor. */
  readonly actor?: string;
}
