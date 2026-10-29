/** One version's entry in CHANGELOG.md. */
export interface Release {
  version: string;
  date: string;
  blocks: Block[];
}

export type Block =
  | { kind: "heading"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "text"; text: string };

/**
 * Reads the parts of Keep a Changelog markdown the file uses: `## version — date`, `### group`,
 * bullets (wrapped lines indented under them) and paragraphs. Text before the first version is
 * the file's introduction and is skipped.
 */
export function parseChangelog(markdown: string): Release[] {
  const releases: Release[] = [];
  let blocks: Block[] | null = null;
  // The block a line without a marker continues; a blank line ends it.
  let last: Block | null = null;

  for (const raw of markdown.split(/\r?\n/u)) {
    const line = raw.trim();
    const version = /^## (\S+)(?:\s+—\s+(.+))?$/u.exec(line);
    if (version !== null) {
      blocks = [];
      last = null;
      releases.push({ version: version[1] ?? "", date: version[2] ?? "", blocks });
    } else if (blocks === null) {
      continue;
    } else if (line === "") {
      last = null;
    } else if (line.startsWith("### ")) {
      blocks.push({ kind: "heading", text: line.slice(4) });
      last = null;
    } else if (line.startsWith("- ")) {
      if (last?.kind === "list") last.items.push(line.slice(2));
      else blocks.push((last = { kind: "list", items: [line.slice(2)] }));
    } else if (last?.kind === "list") {
      last.items[last.items.length - 1] += ` ${line}`;
    } else if (last?.kind === "text") {
      last.text += ` ${line}`;
    } else {
      blocks.push((last = { kind: "text", text: line }));
    }
  }
  return releases;
}

/**
 * A release as the app shows it: its opening line and its `### Highlights`, when it has them.
 * `trimmed` says the rest is left to the releases page.
 */
export function highlightsOf(release: Release): Release & { trimmed: boolean } {
  const start = release.blocks.findIndex(
    (block) => block.kind === "heading" && block.text === "Highlights",
  );
  if (start === -1) return { ...release, trimmed: false };
  const intro = release.blocks.slice(0, start).filter((block) => block.kind === "text");
  const highlights = release.blocks[start + 1];
  const blocks = highlights?.kind === "list" ? [...intro, highlights] : intro;
  return { ...release, blocks, trimmed: true };
}

const SEEN_KEY = "sampo.whatsNewSeen";

/** True until the notes for this version have been seen once. */
export function isNewVersion(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) !== __APP_VERSION__;
  } catch {
    // Storage blocked: better never to show it than to show it on every start.
    return false;
  }
}

export function markVersionSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, __APP_VERSION__);
  } catch {
    // Nothing to remember it in; isNewVersion already says no.
  }
}
