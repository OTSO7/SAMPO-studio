import type { EntityId } from "./ids";

export const ENTITY_KINDS = ["character", "location", "prop"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/**
 * Something the story keeps referring to: a character, a place or an object. Blocks point at
 * entities by id, so renaming "Lyhty" to "Retkilyhty" happens in exactly one place.
 */
export interface Entity {
  readonly id: EntityId;
  readonly kind: EntityKind;
  readonly name: string;
  /** Other spellings the parser should recognise, e.g. inflected Finnish forms. */
  readonly aliases: readonly string[];
  readonly description?: string;
}
