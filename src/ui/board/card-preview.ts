import type { Beat } from "@core/model";

/** Lines of dialogue a collapsed card shows. */
export const MAX_PREVIEW_LINES = 3;

/** About four lines of card text at the board's width; longer text is clipped. */
const MAX_PREVIEW_CHARACTERS = 180;

/** Whether a collapsed card hides anything, so expanding it would show more. */
export function canExpand(beat: Beat): boolean {
  const lines = beat.blocks.filter((block) => block.type === "line");
  const lead = beat.blocks.find((block) => block.type === "action")?.text ?? "";
  return (
    lines.length > MAX_PREVIEW_LINES ||
    lead.length > MAX_PREVIEW_CHARACTERS ||
    lines.some((line) => line.text.length > MAX_PREVIEW_CHARACTERS / 2)
  );
}
