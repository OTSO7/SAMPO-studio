import type { BeatKind } from "../model";

/**
 * Maps an author's beat label to a beat kind. Matching is by substring so that variations
 * like "Taistelu-tutoriaali" or "Minipeli (pimiö)" still land in the right bucket.
 * Anything unrecognised is plain narrative, which is always a safe default.
 */
const LABEL_RULES: readonly (readonly [RegExp, BeatKind])[] = [
  [/minipeli|tutoriaali|tutorial|mekaniikka|mechanic|puzzle|pulma/u, "mechanic"],
  [/shift|siirtymä|transition/u, "shift"],
  [/oivallus|insight|paljastus|reveal/u, "insight"],
];

export function beatKindForLabel(label: string | undefined): BeatKind {
  if (label === undefined) return "narrative";

  const normalized = label.toLocaleLowerCase("fi");
  for (const [pattern, kind] of LABEL_RULES) {
    if (pattern.test(normalized)) return kind;
  }
  return "narrative";
}
