import { describe, expect, it } from "vitest";

import changelog from "../../../CHANGELOG.md?raw";
import { parseChangelog } from "./changelog";

describe("parseChangelog", () => {
  it("reads versions, groups, wrapped bullets and paragraphs", () => {
    const releases = parseChangelog(
      [
        "# Changelog",
        "",
        "Intro text.",
        "",
        "## 1.1.0 — 2026-10-28",
        "",
        "Small release.",
        "",
        "### Added",
        "",
        "- One",
        "- Two that",
        "  wraps",
        "",
        "## 1.0.0 — 2026-10-01",
        "",
        "First.",
      ].join("\n"),
    );

    expect(releases).toEqual([
      {
        version: "1.1.0",
        date: "2026-10-28",
        blocks: [
          { kind: "text", text: "Small release." },
          { kind: "heading", text: "Added" },
          { kind: "list", items: ["One", "Two that wraps"] },
        ],
      },
      { version: "1.0.0", date: "2026-10-01", blocks: [{ kind: "text", text: "First." }] },
    ]);
  });

  // Fails a release whose changelog was not written.
  it("has an entry for the version in package.json", () => {
    expect(parseChangelog(changelog)[0]?.version).toBe(__APP_VERSION__);
  });
});
