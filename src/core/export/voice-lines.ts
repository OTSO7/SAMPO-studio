import type { BeatId, BeatStatus, BlockId, Entity, EntityId, LineBlock, Story } from "../model";

export interface VoiceLine {
  /** Stable across edits and reordering, so recordings stay matched to their line. */
  readonly id: string;
  readonly blockId: BlockId;
  readonly beatId: BeatId;
  readonly speaker: EntityId | null;
  readonly character: string;
  readonly text: string;
  readonly direction: string;
  readonly phase: string;
  readonly card: string;
  readonly heading: string;
  readonly seconds: number;
  /** The card's status, so the studio records only lines from final cards. */
  readonly status: BeatStatus;
  /** The character's voice actor, empty until cast. */
  readonly actor: string;
}

const STATUS_LABELS = { draft: "Draft", review: "Review", final: "Final" } as const;

/** Every spoken line in story order, as a recording script needs it. */
export function collectVoiceLines(story: Story): VoiceLine[] {
  const byId = new Map(story.entities.map((entity: Entity) => [entity.id, entity]));

  return story.phases.flatMap((phase, phaseIndex) =>
    phase.beats.flatMap((beat, beatIndex) =>
      beat.blocks
        .filter((block): block is LineBlock => block.type === "line")
        .map((line) => {
          const speaker = line.speaker === null ? undefined : byId.get(line.speaker);
          const character = speaker?.name ?? "";
          return {
            id: voiceLineId(character, line.id),
            blockId: line.id,
            beatId: beat.id,
            speaker: line.speaker,
            character,
            text: line.text,
            direction: line.direction ?? "",
            phase: `${phaseIndex + 1}. ${phase.title}`,
            card: `${phaseIndex + 1}.${beatIndex + 1}`,
            heading: beat.label ?? "",
            seconds: estimateSeconds(line.text),
            status: beat.status ?? "draft",
            actor: speaker?.actor ?? "",
          };
        }),
    ),
  );
}

/** `VO_ELIAS_5H1C`: the speaker plus the tail of the line's permanent id. */
export function voiceLineId(character: string, blockId: string): string {
  const speaker =
    character
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/gu, "_")
      .replace(/^_+|_+$/gu, "") || "UNASSIGNED";
  return `VO_${speaker}_${blockId.slice(-4).toUpperCase()}`;
}

/** Rough spoken length at a calm pace of 2.5 words a second. */
export function estimateSeconds(text: string): number {
  const words = text.trim().split(/\s+/u).filter(Boolean).length;
  return words === 0 ? 0 : Math.max(1, Math.round(words / 2.5));
}

const COLUMNS: readonly (readonly [string, keyof VoiceLine])[] = [
  ["ID", "id"],
  ["Character", "character"],
  ["Line", "text"],
  ["Direction", "direction"],
  ["Seconds", "seconds"],
  ["Card", "card"],
  ["Card heading", "heading"],
  ["Phase", "phase"],
  // Last, so sheets built on the earlier columns keep working.
  ["Status", "status"],
  ["Actor", "actor"],
];

/**
 * RFC 4180 CSV with a byte order mark, so Excel opens Finnish and other non-English text
 * correctly. Line breaks inside a cell are kept inside quotes.
 */
export function voiceLinesToCsv(lines: readonly VoiceLine[]): string {
  const rows = [
    COLUMNS.map(([header]) => header),
    ...lines.map((line) =>
      COLUMNS.map(([, key]) => (key === "status" ? STATUS_LABELS[line.status] : String(line[key]))),
    ),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function csvCell(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value;
}
