import { createCardTypes, newId } from "../model";
import { CURRENT_VERSION } from "./format";

/**
 * Upgrades the raw `story` payload of an older file, one version at a time.
 *
 * `MIGRATIONS[n]` turns a version `n` payload into version `n + 1`. Migrations work on plain
 * JSON because older files, by definition, do not match today's types; anything they do not
 * understand is passed through untouched for the validator to judge.
 */
const MIGRATIONS: Readonly<Record<number, (story: unknown) => unknown>> = {
  1: fromFixedKindsToCardTypes,
};

export function migrate(story: unknown, fromVersion: number): unknown {
  let current = story;
  for (let version = fromVersion; version < CURRENT_VERSION; version++) {
    const step = MIGRATIONS[version];
    if (step === undefined) {
      throw new Error(`No migration from story format ${version} to ${version + 1}.`);
    }
    current = step(current);
  }
  return current;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Version 1 had four built-in beat kinds; version 2 lets each story define its card types. */
const KIND_TO_TYPE: Readonly<Record<string, string>> = {
  narrative: "Scene",
  mechanic: "Gameplay",
  shift: "Cutscene",
  insight: "Reveal",
};

function fromFixedKindsToCardTypes(story: unknown): unknown {
  if (!isObject(story) || !Array.isArray(story["phases"])) return story;

  const cardTypes = createCardTypes(newId);
  const idByName = new Map(cardTypes.map((type) => [type.name, type.id]));
  const fallback = cardTypes[0]?.id;

  const phases = story["phases"].map((phase) => {
    if (!isObject(phase) || !Array.isArray(phase["beats"])) return phase;
    return {
      ...phase,
      beats: phase["beats"].map((beat) => {
        if (!isObject(beat)) return beat;
        const { kind, ...rest } = beat;
        const name = typeof kind === "string" ? KIND_TO_TYPE[kind] : undefined;
        return {
          ...rest,
          typeId: (name === undefined ? undefined : idByName.get(name)) ?? fallback,
        };
      }),
    };
  });

  return { ...story, cardTypes, phases };
}
