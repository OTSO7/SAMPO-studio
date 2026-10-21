/**
 * Splits a paragraph into prose and spoken lines.
 *
 * A quotation counts as dialogue only when the text right before it ends in a colon, which
 * is how the source material attributes speech: `Elias hourii hengästyneenä: "..."`.
 * Quotations without a colon, such as a name on a door sign, stay part of the prose.
 */

export type DialogueSegment =
  | { readonly kind: "action"; readonly text: string }
  | {
      readonly kind: "line";
      readonly speakerName: string | null;
      readonly direction?: string;
      readonly text: string;
    };

const QUOTE = /["“”„«»]([^"“”„«»]+)["“”„«»]/gu;
// A full stop after a lone capital is an initial ("E. Niemi"), not the end of a sentence.
const SENTENCE_BOUNDARY = /(?<!(?:^|\s)\p{Lu})[.!?…]\s+/gu;
const LEADING_NAME = /^(\p{Lu}[\p{L}-]*\.?(?:\s+\p{Lu}[\p{L}-]*\.?)*)\s*(.*)$/u;
const HAS_LETTERS = /\p{L}/u;

export function splitDialogue(paragraph: string): DialogueSegment[] {
  const segments: DialogueSegment[] = [];
  let cursor = 0;

  for (const match of paragraph.matchAll(QUOTE)) {
    const before = paragraph.slice(cursor, match.index).trimEnd();
    if (!before.endsWith(":")) continue;

    const attributionStart = lastSentenceStart(before);
    pushAction(segments, before.slice(0, attributionStart));
    segments.push({
      kind: "line",
      ...parseAttribution(before.slice(attributionStart, -1)),
      text: (match[1] ?? "").trim(),
    });

    cursor = match.index + match[0].length;
  }

  pushAction(segments, paragraph.slice(cursor));
  return segments;
}

function lastSentenceStart(text: string): number {
  let start = 0;
  for (const boundary of text.matchAll(SENTENCE_BOUNDARY)) {
    start = boundary.index + boundary[0].length;
  }
  return start;
}

function parseAttribution(attribution: string): { speakerName: string | null; direction?: string } {
  const trimmed = attribution.trim();
  const match = LEADING_NAME.exec(trimmed);

  if (match === null) {
    return trimmed === "" ? { speakerName: null } : { speakerName: null, direction: trimmed };
  }

  const speakerName = match[1] ?? null;
  const direction = (match[2] ?? "").trim();
  return direction === "" ? { speakerName } : { speakerName, direction };
}

function pushAction(segments: DialogueSegment[], text: string): void {
  const trimmed = text.trim();
  // Drop leftovers like a lone "." that trails a closing quote.
  if (HAS_LETTERS.test(trimmed)) segments.push({ kind: "action", text: trimmed });
}
