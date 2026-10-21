import type { ImportRow } from "./assemble";
import { segmentText } from "./segment";

/*
 * A first draft of the structure, shown immediately as a board the author corrects by hand.
 * Rules are generic (no story-specific words) and visible: anything they miss is one click
 * from right, and nothing is ever dropped — at worst a line becomes its own card.
 */

const SECTION_WORDS = [
  "act",
  "chapter",
  "part",
  "phase",
  "scene",
  "level",
  "mission",
  "episode",
  "näytös",
  "luku",
  "osa",
  "vaihe",
  "kohtaus",
  "taso",
  "jakso",
  "tehtävä",
].join("|");

/** "VAIHE 1: Alku", "Chapter IV – The Bog", "ACT 2" */
const NUMBERED_HEADING = new RegExp(
  `^(?:${SECTION_WORDS})\\s+(?:\\d+|[ivxlc]+)\\b\\s*[:.\\-–—]?\\s*(.*)$`,
  "iu",
);
/** "# Title", "## Section" */
const MARKDOWN_HEADING = /^(#{1,3})\s+(.+)$/u;
/** Screenplay scene headings: "INT. CABIN - NIGHT" */
const SLUGLINE = /^((?:INT|EXT|I\/E|INT\.\/EXT)\.?\s+.+)$/u;
const LOCATION = /^(?:location|setting|place|tapahtumapaikka|paikka|sijainti)\s*:\s*(.+)$/iu;
const LABEL = /^([^:.!?"“”„«»]{1,40}):\s*(.*)$/su;
const MAX_LABEL_WORDS = 4;
const MAX_TITLE_LENGTH = 90;

type Line =
  | { kind: "phase"; title: string; location?: string }
  | { kind: "title"; text: string }
  | { kind: "location"; text: string }
  | { kind: "card"; label?: string; text: string; raw: string };

export function suggestRows(text: string): ImportRow[] {
  const lines = segmentText(text).map(classify);
  const structured = lines.some((line) => line.kind === "phase");
  const boilerplate = findBoilerplateLabels(lines);

  const rows: ImportRow[] = [];
  lines.forEach((line, index) => {
    switch (line.kind) {
      case "phase":
        rows.push({ role: "phase", text: line.title });
        if (line.location !== undefined) rows.push({ role: "location", text: line.location });
        return;
      case "title":
        rows.push(
          index === 0 || !structured
            ? { role: "title", text: line.text }
            : { role: "phase", text: line.text },
        );
        return;
      case "location":
        rows.push({ role: "location", text: line.text });
        return;
      case "card": {
        const label =
          line.label !== undefined && !boilerplate.has(key(line.label)) ? line.label : undefined;
        const body = line.text;
        if (body === "") return;
        // The first plain line of a structured document is usually its title.
        if (index === 0 && structured && looksLikeTitle(line.raw)) {
          rows.push({ role: "title", text: line.raw });
          return;
        }
        rows.push(
          label === undefined ? { role: "beat", text: body } : { role: "beat", label, text: body },
        );
      }
    }
  });
  return rows;
}

function classify(line: string): Line {
  const numbered = NUMBERED_HEADING.exec(line);
  if (numbered !== null) return { kind: "phase", title: tidyTitle(numbered[1]?.trim() || line) };

  const markdown = MARKDOWN_HEADING.exec(line);
  if (markdown !== null) {
    const text = (markdown[2] ?? "").trim();
    return markdown[1] === "#" ? { kind: "title", text } : { kind: "phase", title: text };
  }

  if (SLUGLINE.test(line)) return { kind: "phase", title: line, location: line };

  const location = LOCATION.exec(line);
  if (location !== null) {
    return { kind: "location", text: (location[1] ?? "").trim().replace(/\.$/u, "") };
  }

  const label = LABEL.exec(line);
  const name = label?.[1]?.trim();
  const body = label?.[2]?.trim();
  if (
    name !== undefined &&
    body !== undefined &&
    name.split(/\s+/u).length <= MAX_LABEL_WORDS &&
    // `Elias says: "..."` is speech, not a heading.
    !/^["“”„«»]/u.test(body)
  ) {
    return { kind: "card", label: capitalize(name), text: body, raw: line };
  }
  return { kind: "card", text: line, raw: line };
}

/**
 * A label that opens paragraphs in several different phases ("Events:", "Gameplay:") is a
 * section marker of the document's template, not something worth showing on every card.
 */
function findBoilerplateLabels(lines: readonly Line[]): Set<string> {
  const phasesPerLabel = new Map<string, Set<number>>();
  let phase = 0;
  for (const line of lines) {
    if (line.kind === "phase") phase++;
    if (line.kind === "card" && line.label !== undefined) {
      const seen = phasesPerLabel.get(key(line.label)) ?? new Set<number>();
      seen.add(phase);
      phasesPerLabel.set(key(line.label), seen);
    }
  }
  const phaseCount = Math.max(phase, 1);
  const threshold = Math.max(2, Math.ceil(phaseCount / 2));
  return new Set(
    [...phasesPerLabel].filter(([, phases]) => phases.size >= threshold).map(([label]) => label),
  );
}

function looksLikeTitle(line: string): boolean {
  return line.length <= MAX_TITLE_LENGTH && !/[.!?"”»]$/u.test(line);
}

/** "THE LONG NIGHT" -> "The long night". Mixed case is kept as written. */
function tidyTitle(title: string): string {
  if (title !== title.toLocaleUpperCase()) return title;
  return capitalize(title.toLocaleLowerCase());
}

function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

function key(label: string): string {
  return label.toLocaleLowerCase();
}
