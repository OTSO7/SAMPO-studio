import { describe, expect, it } from "vitest";

import changelog from "../../../CHANGELOG.md?raw";
import { highlightsOf, parseChangelog } from "./changelog";

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

  it("shows a release by its highlights, leaving the rest to the releases page", () => {
    const [release] = parseChangelog(
      [
        "## 2.0.0 — 2026-11-01",
        "",
        "Big one.",
        "",
        "### Highlights",
        "",
        "- The best part",
        "",
        "### Fixed",
        "",
        "- A small thing",
      ].join("\n"),
    );
    if (release === undefined) throw new Error("not parsed");

    expect(highlightsOf(release)).toEqual({
      version: "2.0.0",
      date: "2026-11-01",
      blocks: [
        { kind: "text", text: "Big one." },
        { kind: "list", items: ["The best part"] },
      ],
      trimmed: true,
    });
    // Releases written before highlights show whole, with nothing left out.
    const old = parseChangelog("## 1.0.0 — 2026-10-01\n\nFirst.\n")[0];
    if (old === undefined) throw new Error("not parsed");
    expect(highlightsOf(old).trimmed).toBe(false);
  });

  it("shows the big 0.6.0 release by its highlights; small releases show whole", () => {
    const releases = parseChangelog(changelog).map(highlightsOf);
    expect(releases.find((release) => release.version === "0.6.0")?.trimmed).toBe(true);
    expect(releases.find((release) => release.version === "0.6.1")?.trimmed).toBe(false);
  });

  // Fails a release whose changelog was not written.
  it("has an entry for the version in package.json", () => {
    expect(parseChangelog(changelog)[0]?.version).toBe(__APP_VERSION__);
  });
});
