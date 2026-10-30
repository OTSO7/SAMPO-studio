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
const MARKDOWN_HEADING = /^(#{1,6})\s+(.+)$/u;
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
  | { kind: "card"; label?: string; text: string; raw: string }
  | { kind: "line"; speaker: string; text: string; raw: string };

const MAX_SPEAKER_WORDS = 3;
/** Text with fewer headings than this is not treated as a structured document. */
const MIN_OUTLINE_HEADINGS = 3;
/** So many headings before the first "Act I" means it is a section, not how the text divides. */
const MIN_HEADINGS_BEFORE_PHASE = 3;
const MAX_HEADING_LENGTH = 70;
const MAX_HEADING_WORDS = 8;
const MIN_PROSE_LENGTH = 30;

export function suggestRows(text: string): ImportRow[] {
  const raw = segmentText(text);
  const outline = headedOutline(raw) ?? plainOutline(raw);
  if (outline !== null) return outline;

  const lines = raw.map(classify);
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
      case "line":
        // "ROUTA: Demo slice" opening a structured document is its title, not a speaker.
        if (index === 0 && structured && looksLikeTitle(line.raw)) {
          rows.push({ role: "title", text: line.raw });
          return;
        }
        // Lines join the card before them, so a scene keeps its action and its dialogue.
        rows.push({ role: "line", speaker: line.speaker, text: line.text });
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

/**
 * A document with headings on more than one level, such as a design document: the top level
 * makes phases, the levels below make cards, and everything under a heading stays on its card.
 * With one level only, the text is more like a script: `null` leaves it to the rules below.
 */
function headedOutline(raw: readonly string[]): ImportRow[] | null {
  const levelOf = (line: string) => MARKDOWN_HEADING.exec(line)?.[1]?.length ?? null;
  const titled = raw[0] !== undefined && levelOf(raw[0]) !== null;
  const levels = raw
    .slice(titled ? 1 : 0)
    .map(levelOf)
    .filter((level) => level !== null);
  if (new Set(levels).size < 2) return null;
  const top = Math.min(...levels);

  return raw.map((line, index): ImportRow => {
    const level = levelOf(line);
    const heading = MARKDOWN_HEADING.exec(line)?.[2]?.trim() ?? "";
    if (level === null) return bodyRow(line);
    if (index === 0) return { role: "title", text: heading };
    return level === top
      ? { role: "phase", text: heading }
      : { role: "beat", label: heading, text: "" };
  });
}

/**
 * The same kind of document pasted as plain text, where headings can only be told by their
 * shape: a short line with no sentence ending, followed by prose. Several short lines in a row
 * are a table or a list, not headings. `null` for anything else, which is how a script stays
 * a script.
 */
function plainOutline(raw: readonly string[]): ImportRow[] | null {
  const short = (line: string | undefined) =>
    line !== undefined &&
    line.length <= MAX_HEADING_LENGTH &&
    line.split(" ").length <= MAX_HEADING_WORDS &&
    !/[.!?…;,]$/u.test(line) &&
    classify(line).kind !== "line";
  const prose = (line: string | undefined) =>
    line !== undefined &&
    line.length >= MIN_PROSE_LENGTH &&
    // A sentence may end in an emoji.
    (/[.!?…:)]\P{L}*$/u.test(line) || line.length >= 2 * MIN_PROSE_LENGTH);
  const isHeading = raw.map(
    (line, index) =>
      short(line) &&
      prose(raw[index + 1]) &&
      // The end of a run of short lines is a table's last cell; the document's top is not a run.
      !(index > 2 && short(raw[index - 1]) && short(raw[index - 2])),
  );

  const headings = isHeading.filter(Boolean).length;
  const spoken = raw.filter((line) => classify(line).kind === "line").length;
  const firstPhase = raw.findIndex((line) => classify(line).kind === "phase");
  const beforePhase = isHeading.slice(0, Math.max(firstPhase, 0)).filter(Boolean).length;
  if (
    headings < MIN_OUTLINE_HEADINGS ||
    spoken > headings ||
    (firstPhase !== -1 && beforePhase < MIN_HEADINGS_BEFORE_PHASE)
  ) {
    return null;
  }

  return raw.map((line, index): ImportRow => {
    if (index === 0 && short(line)) return { role: "title", text: line };
    if (isHeading[index]) return { role: "beat", label: line.replace(/:$/u, ""), text: "" };
    return bodyRow(line);
  });
}

function bodyRow(line: string): ImportRow {
  const parsed = classify(line);
  return parsed.kind === "line"
    ? { role: "line", speaker: parsed.speaker, text: parsed.text }
    : { role: "text", text: line };
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
  if (name !== undefined && body !== undefined && body !== "" && isSpeaker(name, body)) {
    return { kind: "line", speaker: speakerName(name), text: body, raw: line };
  }
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
 * Only the two conventions writers use for dialogue, so labels like "Gameplay:" stay cards:
 * a screenplay cue in capitals ("AATOS: …", "MUSTA ROUTA: …"), or one name before quoted
 * speech (`Elias: "Hei."`).
 */
function isSpeaker(name: string, body: string): boolean {
  const words = name.split(/\s+/u);
  const cue =
    words.length <= MAX_SPEAKER_WORDS &&
    name === name.toLocaleUpperCase() &&
    /\p{Lu}/u.test(name) &&
    !/\d/u.test(name);
  const quoted = words.length === 1 && /^\p{Lu}/u.test(name) && /^["“”„«»]/u.test(body);
  return cue || quoted;
}

/** "MUSTA ROUTA" -> "Musta Routa"; names written in mixed case are kept as written. */
function speakerName(name: string): string {
  if (name !== name.toLocaleUpperCase()) return name;
  return name
    .toLocaleLowerCase()
    .split(/(\s+|-)/u)
    .map(capitalize)
    .join("");
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
