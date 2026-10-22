import { useMemo, useState } from "react";

import { collectVoiceLines } from "@core/export";
import {
  BEAT_STATUSES,
  setLineDirection,
  updateBeat,
  updateBlockText,
  type BeatId,
  type BeatStatus,
  type EntityId,
  type Story,
} from "@core/model";
import { AudioPlayer } from "@ui/board/AudioPlayer";
import { STATUS_NAMES } from "@ui/board/status";
import { useServices } from "@ui/services/use-services";

import "./lines.css";

interface LinesViewProps {
  story: Story;
  edit: (recipe: (story: Story) => Story, group?: string) => void;
  onOpenCard: (beatId: BeatId) => void;
}

type SpeakerFilter = EntityId | "all" | "unassigned";

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/**
 * All dialogue in story order, as a table: for writing passes, voice casting and recording
 * prep. Lines and directions are editable in place; a card number jumps back to the board.
 */
export function LinesView({ story, edit, onOpenCard }: LinesViewProps) {
  const [speaker, setSpeaker] = useState<SpeakerFilter>("all");
  const [status, setStatus] = useState<BeatStatus | "all">("all");
  const { files } = useServices().deps;
  const lines = useMemo(() => collectVoiceLines(story), [story]);
  const colors = useMemo(
    () => new Map(story.entities.map((entity) => [entity.id, entity.color ?? "slate"])),
    [story.entities],
  );

  const counts = new Map<SpeakerFilter, number>();
  for (const line of lines) {
    const key = line.speaker ?? "unassigned";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const characters = story.entities.filter(
    (entity) => entity.kind === "character" && counts.has(entity.id),
  );

  const statusCounts = new Map<BeatStatus, number>();
  for (const line of lines) statusCounts.set(line.status, (statusCounts.get(line.status) ?? 0) + 1);

  const visible = lines.filter(
    (line) =>
      (status === "all" || line.status === status) &&
      (speaker === "all"
        ? true
        : speaker === "unassigned"
          ? line.speaker === null
          : line.speaker === speaker),
  );
  const seconds = visible.reduce((total, line) => total + line.seconds, 0);

  if (lines.length === 0) {
    return (
      <div className="lines lines--empty">
        <p className="lines__empty-title">No dialogue yet</p>
        <p className="lines__empty-body">
          Add a dialogue card on the board, or turn any text into a line in a card.
        </p>
      </div>
    );
  }

  return (
    <div className="lines">
      <header className="lines__head">
        <div className="lines__filters" role="radiogroup" aria-label="Character">
          <FilterChip
            label="All"
            count={lines.length}
            active={speaker === "all"}
            onClick={() => {
              setSpeaker("all");
            }}
          />
          {characters.map((entity) => (
            <FilterChip
              key={entity.id}
              label={entity.name}
              swatch={entity.color ?? "slate"}
              count={counts.get(entity.id) ?? 0}
              active={speaker === entity.id}
              onClick={() => {
                setSpeaker(entity.id);
              }}
            />
          ))}
          {counts.has("unassigned") && (
            <FilterChip
              label="No speaker"
              count={counts.get("unassigned") ?? 0}
              active={speaker === "unassigned"}
              onClick={() => {
                setSpeaker("unassigned");
              }}
            />
          )}
        </div>
        <div className="lines__filters" role="radiogroup" aria-label="Card status">
          <FilterChip
            label="Any status"
            count={lines.length}
            active={status === "all"}
            onClick={() => {
              setStatus("all");
            }}
          />
          {BEAT_STATUSES.map((value) => (
            <FilterChip
              key={value}
              label={STATUS_NAMES[value]}
              count={statusCounts.get(value) ?? 0}
              active={status === value}
              onClick={() => {
                setStatus(value);
              }}
            />
          ))}
        </div>
        <p className="lines__summary">
          {visible.length} {visible.length === 1 ? "line" : "lines"} · ≈ {formatDuration(seconds)}
        </p>
      </header>

      <div className="lines__scroller">
        <table className="lines__table">
          <thead>
            <tr>
              <th className="lines__col-card">Card</th>
              <th className="lines__col-status">Status</th>
              <th className="lines__col-speaker">Character</th>
              <th>Line</th>
              <th className="lines__col-direction">Direction</th>
              <th className="lines__col-time">Time</th>
              <th className="lines__col-take">Take</th>
              <th className="lines__col-id">ID</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((line) => (
              <tr key={line.blockId}>
                <td>
                  <button
                    type="button"
                    className="lines__card"
                    title={`Open card ${line.card} on the board`}
                    onClick={() => {
                      onOpenCard(line.beatId);
                    }}
                  >
                    {line.card}
                  </button>
                </td>
                <td>
                  <button
                    type="button"
                    className="lines__status"
                    data-status={line.status}
                    title={`Card ${line.card} is ${STATUS_NAMES[line.status].toLowerCase()}. Click for the next status; it applies to the whole card.`}
                    onClick={() => {
                      const next = BEAT_STATUSES[(BEAT_STATUSES.indexOf(line.status) + 1) % 3];
                      edit((s) => updateBeat(s, line.beatId, { status: next ?? "draft" }));
                    }}
                  >
                    {STATUS_NAMES[line.status]}
                  </button>
                </td>
                <td>
                  <span
                    className="lines__speaker"
                    data-swatch={line.speaker === null ? "slate" : colors.get(line.speaker)}
                  >
                    {line.character || "—"}
                  </span>
                </td>
                <td>
                  <textarea
                    className="lines__text"
                    aria-label={`Line ${line.id}`}
                    value={line.text}
                    placeholder="…"
                    onChange={(event) => {
                      const text = event.target.value;
                      edit((s) => updateBlockText(s, line.blockId, text), `text:${line.blockId}`);
                    }}
                  />
                </td>
                <td>
                  <input
                    className="lines__direction"
                    aria-label={`Direction for ${line.id}`}
                    value={line.direction}
                    placeholder="—"
                    onChange={(event) => {
                      const direction = event.target.value;
                      edit(
                        (s) => setLineDirection(s, line.blockId, direction),
                        `direction:${line.blockId}`,
                      );
                    }}
                  />
                </td>
                <td className="lines__time">{line.seconds > 0 ? `${line.seconds} s` : ""}</td>
                <td>
                  {line.take !== undefined && (
                    <AudioPlayer
                      compact
                      url={files.mediaUrl(line.take)}
                      label={`Take of ${line.id}`}
                    />
                  )}
                </td>
                <td className="lines__id">{line.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  swatch,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  swatch?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      className="lines__chip"
      data-swatch={swatch}
      onClick={onClick}
    >
      {swatch !== undefined && <span className="swatch-dot" />}
      {label}
      <span className="lines__chip-count">{count}</span>
    </button>
  );
}
