import { describe, expect, it } from "vitest";

import type { BeatKind } from "../model";
import { beatKindForLabel } from "./beat-kind";

const cases: [label: string | undefined, kind: BeatKind][] = [
  ["Minipeli", "mechanic"],
  ["Taistelu-tutoriaali", "mechanic"],
  ["The Shift", "shift"],
  ["Oivallus", "insight"],
  ["Tutkinta", "narrative"],
  ["Orgaaninen ohjaus (Ei pakkokameraa)", "narrative"],
  [undefined, "narrative"],
];

describe("beatKindForLabel", () => {
  it.each(cases)("maps %s to %s", (label, kind) => {
    expect(beatKindForLabel(label)).toBe(kind);
  });
});
