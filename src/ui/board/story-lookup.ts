import type { CardType, CardTypeId, Entity, EntityId, Story } from "@core/model";

/** Fast lookups the board needs on every render, built once per story change. */
export interface StoryLookup {
  readonly typeById: ReadonlyMap<CardTypeId, CardType>;
  readonly entityById: ReadonlyMap<EntityId, Entity>;
  readonly defaultTypeId: CardTypeId | undefined;
}

export function buildLookup(story: Story): StoryLookup {
  return {
    typeById: new Map(story.cardTypes.map((type) => [type.id, type])),
    entityById: new Map(story.entities.map((entity) => [entity.id, entity])),
    defaultTypeId: story.cardTypes[0]?.id,
  };
}

export { estimateSeconds } from "@core/export";
