/**
 * Named colours for card types and characters. Names, not hex values, are stored in files,
 * so the theme can tune the actual shades without touching anyone's stories.
 */
export const SWATCHES = [
  "bone",
  "ochre",
  "signal",
  "rose",
  "moss",
  "violet",
  "slate",
  "amber",
  "red",
  "coral",
  "lime",
  "teal",
  "sky",
  "blue",
  "magenta",
  "sand",
] as const;

export type Swatch = (typeof SWATCHES)[number];

export function isSwatch(value: unknown): value is Swatch {
  return typeof value === "string" && (SWATCHES as readonly string[]).includes(value);
}

/** Cycles through the palette so each new item gets a different colour. */
export function nextSwatch(used: readonly (Swatch | undefined)[]): Swatch {
  const unused = SWATCHES.find((swatch) => !used.includes(swatch));
  return unused ?? SWATCHES[used.length % SWATCHES.length] ?? "bone";
}
