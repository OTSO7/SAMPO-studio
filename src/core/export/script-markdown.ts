import type { Story } from "../model";

/**
 * The story as a readable script: phases as chapters, cards as numbered sections, dialogue
 * in screenplay style. Notes are left out unless asked for, since they are not canon.
 */
export function storyToMarkdown(story: Story, options: { includeNotes?: boolean } = {}): string {
  const names = new Map(story.entities.map((entity) => [entity.id, entity.name]));
  const types = new Map(story.cardTypes.map((type) => [type.id, type.name]));
  const defaultType = story.cardTypes[0]?.id;
  const out: string[] = [`# ${story.title}`, ""];

  story.phases.forEach((phase, phaseIndex) => {
    const number = String(phaseIndex + 1).padStart(2, "0");
    out.push(`## ${number} ${phase.title}`);
    if (phase.location !== undefined) out.push("", `*${phase.location}*`);
    out.push("");

    phase.beats.forEach((beat, beatIndex) => {
      const type = beat.typeId === defaultType ? undefined : types.get(beat.typeId);
      const heading = [beat.label, type === undefined ? undefined : `[${type}]`]
        .filter(Boolean)
        .join(" ");
      out.push(`### ${phaseIndex + 1}.${beatIndex + 1}${heading === "" ? "" : ` ${heading}`}`, "");

      for (const block of beat.blocks) {
        if (block.text.trim() === "" && block.type !== "line") continue;
        if (block.type === "action") {
          out.push(block.text, "");
        } else if (block.type === "line") {
          const speaker = (block.speaker === null ? undefined : names.get(block.speaker)) ?? "—";
          const direction = block.direction === undefined ? "" : ` *(${block.direction})*`;
          out.push(`**${speaker.toUpperCase()}**${direction}  `, `${block.text || "…"}`, "");
        } else if (options.includeNotes === true) {
          out.push(`> Note: ${block.text}`, "");
        }
      }
    });
  });

  return `${out.join("\n").trimEnd()}\n`;
}
