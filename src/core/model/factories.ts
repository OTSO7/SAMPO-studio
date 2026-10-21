import { newId, type IdFactory } from "./ids";
import type { Swatch } from "./palette";
import type { CardType, Story } from "./story";

export const UNTITLED_STORY = "Untitled";

/** A neutral starting set that suits most games and stories; authors change it freely. */
export const DEFAULT_CARD_TYPES: readonly { readonly name: string; readonly color: Swatch }[] = [
  { name: "Scene", color: "bone" },
  { name: "Dialogue", color: "signal" },
  { name: "Gameplay", color: "ochre" },
  { name: "Cutscene", color: "violet" },
  { name: "Reveal", color: "rose" },
];

export function createCardTypes(ids: IdFactory = newId): CardType[] {
  return DEFAULT_CARD_TYPES.map((type) => ({ id: ids.cardType(), ...type }));
}

export function createStory(title: string = UNTITLED_STORY, ids: IdFactory = newId): Story {
  return { id: ids.story(), title, cardTypes: createCardTypes(ids), phases: [], entities: [] };
}

/** The type new cards get: the first one in the list. */
export function defaultCardType(story: Story): CardType {
  const first = story.cardTypes[0];
  if (first === undefined) throw new Error("A story must have at least one card type.");
  return first;
}

/** Finds a card type by name, ignoring case, e.g. to place a new dialogue card. */
export function findCardType(story: Story, name: string): CardType | undefined {
  const key = name.trim().toLocaleLowerCase();
  return story.cardTypes.find((type) => type.name.toLocaleLowerCase() === key);
}
