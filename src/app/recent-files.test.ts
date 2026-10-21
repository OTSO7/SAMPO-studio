import { describe, expect, it } from "vitest";

import { createRecentFiles, type KeyValueStorage } from "./recent-files";

function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe("createRecentFiles", () => {
  it("lists the newest first without duplicates", () => {
    const recent = createRecentFiles(memoryStorage());
    recent.add("D:/a.sampo");
    recent.add("D:/b.sampo");
    recent.add("D:/A.sampo");
    expect(recent.list()).toEqual(["D:/A.sampo", "D:/b.sampo"]);
  });

  it("keeps at most eight", () => {
    const recent = createRecentFiles(memoryStorage());
    for (let i = 0; i < 12; i++) recent.add(`D:/${i}.sampo`);
    expect(recent.list()).toHaveLength(8);
    expect(recent.list()[0]).toBe("D:/11.sampo");
  });

  it("forgets a file", () => {
    const recent = createRecentFiles(memoryStorage());
    recent.add("D:/a.sampo");
    recent.remove("D:/a.sampo");
    expect(recent.list()).toEqual([]);
  });

  it("works without storage and survives corrupt data", () => {
    expect(createRecentFiles(null).list()).toEqual([]);
    const storage = memoryStorage();
    storage.setItem("sampo.recentFiles", "{not json");
    expect(createRecentFiles(storage).list()).toEqual([]);
  });
});
