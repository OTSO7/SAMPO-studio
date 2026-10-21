import { CURRENT_VERSION } from "./format";

/**
 * Upgrades the raw `story` payload of an older file, one version at a time.
 *
 * `MIGRATIONS[n]` turns a version `n` payload into version `n + 1`. Migrations work on plain
 * JSON because older files, by definition, do not match today's types.
 */
const MIGRATIONS: Readonly<Record<number, (story: unknown) => unknown>> = {};

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
