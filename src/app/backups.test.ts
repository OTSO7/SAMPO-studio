import { describe, expect, it } from "vitest";

import { backupsToDrop, type Backup } from "./backups";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 28, 12);

/** Newest first, `count` copies `step` apart. */
const history = (count: number, step: number): Backup[] =>
  Array.from({ length: count }, (_, i) => ({
    path: `b${i}`,
    name: `b${i}`,
    modified: NOW - i * step,
    size: 1,
  }));

describe("backupsToDrop", () => {
  it("keeps everything while there are few", () => {
    expect(backupsToDrop(history(20, 60_000), NOW)).toEqual([]);
  });

  it("keeps the 20 newest and one a day after that", () => {
    const backups = history(200, 60 * 60 * 1000); // hourly, about eight days
    const kept = new Set(backups.map((b) => b.path));
    for (const dropped of backupsToDrop(backups, NOW)) kept.delete(dropped.path);

    const older = backups.slice(20).filter((b) => kept.has(b.path));
    const days = new Set(older.map((b) => Math.floor(b.modified / DAY)));
    expect(older.length).toBe(days.size);
    expect(days.size).toBeGreaterThanOrEqual(7);
    for (const b of backups.slice(0, 20)) expect(kept.has(b.path)).toBe(true);
  });

  it("lets daily copies go after 60 days", () => {
    const backups = history(100, DAY);
    const dropped = backupsToDrop(backups, NOW).map((b) => b.path);
    expect(dropped).toContain("b80");
    expect(dropped).not.toContain("b50");
  });
});
