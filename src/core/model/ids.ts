declare const brand: unique symbol;

/**
 * Nominal typing for string identifiers. A `BeatId` and a `PhaseId` are both strings at
 * runtime, but the compiler refuses to mix them up.
 */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type StoryId = Brand<string, "StoryId">;
export type PhaseId = Brand<string, "PhaseId">;
export type BeatId = Brand<string, "BeatId">;
export type BlockId = Brand<string, "BlockId">;
export type EntityId = Brand<string, "EntityId">;
