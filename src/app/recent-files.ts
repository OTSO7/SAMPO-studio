/** Minimal key-value storage, so tests can use a plain object instead of the browser's. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface RecentFiles {
  list(): readonly string[];
  add(path: string): void;
  remove(path: string): void;
}

const KEY = "sampo.recentFiles";
const LIMIT = 8;

/**
 * The stories opened most recently on this computer, newest first. Paths only: the stories
 * themselves never leave their files. Storage failures just mean nothing is remembered.
 */
export function createRecentFiles(storage: KeyValueStorage | null): RecentFiles {
  const read = (): string[] => {
    try {
      const parsed: unknown = JSON.parse(storage?.getItem(KEY) ?? "[]");
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
    } catch {
      return [];
    }
  };
  const write = (paths: readonly string[]) => {
    try {
      storage?.setItem(KEY, JSON.stringify(paths));
    } catch {
      // Not remembered; harmless.
    }
  };
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

  return {
    list: read,
    add(path) {
      write([path, ...read().filter((other) => !same(other, path))].slice(0, LIMIT));
    },
    remove(path) {
      write(read().filter((other) => !same(other, path)));
    },
  };
}
