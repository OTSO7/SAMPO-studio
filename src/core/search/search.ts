import type { BeatId, PhaseId, Story } from "../model";

export interface SearchResult {
  readonly kind: "phase" | "card";
  readonly phaseId: PhaseId;
  readonly beatId?: BeatId;
  /** "2" for a phase, "2.3" for a card. */
  readonly number: string;
  readonly title: string;
  /** The matching text with some context, for display. */
  readonly excerpt: string;
  /** Where in the excerpt the match starts, to highlight it. */
  readonly matchStart: number;
  readonly matchLength: number;
}

const CONTEXT = 48;
const DEFAULT_LIMIT = 50;

/**
 * Finds phases and cards whose title, heading, text, dialogue, speaker or notes contain the
 * query. Case and accents are ignored, so "aiti" finds "Äiti". Titles rank above body text.
 */
export function searchStory(story: Story, query: string, limit = DEFAULT_LIMIT): SearchResult[] {
  const needle = fold(query.trim());
  if (needle === "") return [];

  const names = new Map(story.entities.map((entity) => [entity.id, entity.name]));
  const titleHits: SearchResult[] = [];
  const bodyHits: SearchResult[] = [];

  story.phases.forEach((phase, phaseIndex) => {
    const phaseNumber = String(phaseIndex + 1);
    for (const text of [phase.title, phase.location ?? ""]) {
      const hit = match(text, needle);
      if (hit !== null) {
        titleHits.push({
          kind: "phase",
          phaseId: phase.id,
          number: phaseNumber,
          title: phase.title,
          ...hit,
        });
        break;
      }
    }

    phase.beats.forEach((beat, beatIndex) => {
      const number = `${phaseNumber}.${beatIndex + 1}`;
      const lead = beat.blocks.find((block) => block.type === "action")?.text ?? "";
      const title = beat.label ?? firstWords(lead);
      const base = { kind: "card" as const, phaseId: phase.id, beatId: beat.id, number, title };

      const heading = match(beat.label ?? "", needle);
      if (heading !== null) {
        titleHits.push({ ...base, ...heading });
        return;
      }

      for (const block of beat.blocks) {
        const speaker =
          block.type === "line" && block.speaker !== null ? names.get(block.speaker) : undefined;
        const text = speaker === undefined ? block.text : `${speaker}: ${block.text}`;
        const hit = match(text, needle);
        if (hit !== null) {
          bodyHits.push({ ...base, ...hit });
          return;
        }
      }
    });
  });

  return [...titleHits, ...bodyHits].slice(0, limit);
}

/** Lower case without accents, so searches match however the author typed it. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

function match(
  text: string,
  needle: string,
): Pick<SearchResult, "excerpt" | "matchStart" | "matchLength"> | null {
  // Folding only removes combining marks, so indices in the folded text map back closely
  // enough for an excerpt; compute positions on the original to keep highlights exact.
  const folded = fold(text);
  const index = folded.indexOf(needle);
  if (index === -1) return null;

  const original = text.normalize("NFC");
  const start = Math.max(0, index - CONTEXT);
  const end = Math.min(original.length, index + needle.length + CONTEXT);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < original.length ? "…" : "";
  return {
    excerpt: `${prefix}${original.slice(start, end)}${suffix}`,
    matchStart: prefix.length + (index - start),
    matchLength: needle.length,
  };
}

function firstWords(text: string, max = 8): string {
  const words = text.trim().split(/\s+/u);
  return words.length <= max ? text.trim() : `${words.slice(0, max).join(" ")}…`;
}
