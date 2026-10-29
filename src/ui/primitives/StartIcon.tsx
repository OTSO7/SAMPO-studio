/** Rows show this many at first; the rest are one click away. */
export const LIST_LIMIT = 5;

const ICONS = {
  plus: "M8 3v10M3 8h10",
  file: "M4 2h5l3 3v9H4zM9 2v3h3",
  folder: "M2 4h4l1.5 1.5H14V13H2z",
  paste: "M5 3h6v2H5zM4 4H3v10h10V4h-1M6 9h4M6 11h3",
  people:
    "M6 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM2 13c0-2.2 1.8-4 4-4s4 1.8 4 4M11 7a1.6 1.6 0 1 0 0-3.2M12 9.2c1.2.4 2 1.6 2 3.8",
} as const;

/** Small line icons, drawn in the text colour, so rows can be scanned by shape. */
export function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg className="start__icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}
