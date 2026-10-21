import { createUlidGenerator, ULID_PATTERN, type IdSource } from "./id-generator";

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

/**
 * Short prefixes make ids self-describing in files, diffs and engine logs:
 * `bt_01JB3Z8Q4M6V2N7KXW9R0T5H1C` is obviously a beat.
 */
const PREFIXES = {
  story: "st",
  phase: "ph",
  beat: "bt",
  block: "bk",
  entity: "en",
} as const;

export type IdKind = keyof typeof PREFIXES;

interface IdTypes {
  story: StoryId;
  phase: PhaseId;
  beat: BeatId;
  block: BlockId;
  entity: EntityId;
}

export type IdFactory = { readonly [K in IdKind]: () => IdTypes[K] };

export function createIdFactory(source?: IdSource): IdFactory {
  const next = createUlidGenerator(source);
  const make =
    <K extends IdKind>(kind: K) =>
    () =>
      `${PREFIXES[kind]}_${next()}` as IdTypes[K];

  return {
    story: make("story"),
    phase: make("phase"),
    beat: make("beat"),
    block: make("block"),
    entity: make("entity"),
  };
}

/** Process-wide factory. Tests should build their own with a deterministic source. */
export const newId: IdFactory = createIdFactory();

/** Validates an id read from disk. Returns `null` instead of throwing so callers can report. */
export function parseId<K extends IdKind>(kind: K, value: unknown): IdTypes[K] | null {
  if (typeof value !== "string") return null;

  const prefix = `${PREFIXES[kind]}_`;
  if (!value.startsWith(prefix)) return null;

  return ULID_PATTERN.test(value.slice(prefix.length)) ? (value as IdTypes[K]) : null;
}
