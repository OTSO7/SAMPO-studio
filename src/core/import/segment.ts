/**
 * Turning pasted text into rows the author can mark up.
 *
 * This is the only automatic step of an import, so it is deliberately dumb: one row per
 * non-empty line. Word processors add invisible characters when copying (Google Docs puts
 * a zero-width space before every paragraph), and those are removed here.
 */

const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/gu;
const ODD_SPACES = /[\u00A0\u2007\u202F\t]/gu;
const QUOTES = new Set(['"', "“", "”", "„", "«", "»"]);
const SENTENCE_END = new Set([".", "!", "?", "…"]);

export function normalizeText(text: string): string {
  return text.replace(/\r\n?/gu, "\n").replace(INVISIBLE, "").replace(ODD_SPACES, " ");
}

export function segmentText(text: string): string[] {
  return normalizeText(text)
    .split("\n")
    .map((line) => line.replace(/ {2,}/gu, " ").trim())
    .filter((line) => line !== "");
}

/**
 * Splits a paragraph into sentences without breaking quotations apart or treating initials
 * such as "E. Niemi" as sentence ends.
 */
export function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let inQuote = false;
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    const next = text.charAt(i + 1);

    if (QUOTES.has(char)) {
      inQuote = !inQuote;
      // A closing quote right after a sentence end finishes the sentence: `…en uskalla."`
      if (!inQuote && SENTENCE_END.has(text.charAt(i - 1)) && next === " ") {
        sentences.push(text.slice(start, i + 1));
        start = i + 1;
      }
      continue;
    }

    if (!inQuote && SENTENCE_END.has(char) && next === " " && !isInitial(text, i)) {
      sentences.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }

  sentences.push(text.slice(start));
  return sentences.map((sentence) => sentence.trim()).filter((sentence) => sentence !== "");
}

/** True when the full stop at `index` follows a lone capital letter, like the E in "E. Niemi". */
function isInitial(text: string, index: number): boolean {
  const before = text.charAt(index - 1);
  const twoBefore = text.charAt(index - 2);
  return (
    text.charAt(index) === "." &&
    before !== before.toLowerCase() &&
    (twoBefore === "" || twoBefore === " ")
  );
}

export interface DialogueGuess {
  readonly speaker: string;
  readonly text: string;
}

const ATTRIBUTED_QUOTE = /^(.*?):\s*["“”„«»](.+)["“”„«»]\s*\.?$/su;
const LEADING_NAME = /^\p{Lu}[\p{L}-]*\.?(?:\s+\p{Lu}[\p{L}-]*\.?)*/u;

/**
 * Offers a starting point when a row is marked as dialogue: `Elias hourii: "Askeleet..."`
 * suggests speaker "Elias" and text "Askeleet...". The author always confirms or edits it.
 */
export function guessDialogue(row: string): DialogueGuess {
  const match = ATTRIBUTED_QUOTE.exec(row);
  if (match === null) return { speaker: "", text: stripQuotes(row) };

  const prefix = (match[1] ?? "").trim();
  return {
    speaker: LEADING_NAME.exec(prefix)?.[0] ?? "",
    text: (match[2] ?? "").trim(),
  };
}

export function stripQuotes(text: string): string {
  const trimmed = text.trim();
  const first = trimmed.charAt(0);
  const last = trimmed.charAt(trimmed.length - 1);
  return trimmed.length >= 2 && QUOTES.has(first) && QUOTES.has(last)
    ? trimmed.slice(1, -1).trim()
    : trimmed;
}
