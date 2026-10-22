import { memo, type PointerEvent } from "react";

import type { Beat } from "@core/model";
import { useServices } from "@ui/services/use-services";
import { STATUS_NAMES } from "./status";
import type { StoryLookup } from "./story-lookup";

interface BeatCardProps {
  beat: Beat;
  number: string;
  lookup: StoryLookup;
  selected?: boolean;
  hidden?: boolean;
  onSelect?: (beat: Beat) => void;
  onPointerDown?: (event: PointerEvent<HTMLElement>, beat: Beat) => void;
}

const MAX_PREVIEW_LINES = 3;

/** A card on the board: number, first picture, heading, opening text and dialogue. */
export const BeatCard = memo(function BeatCard({
  beat,
  number,
  lookup,
  selected = false,
  hidden = false,
  onSelect,
  onPointerDown,
}: BeatCardProps) {
  const type = lookup.typeById.get(beat.typeId);
  const lead = beat.blocks.find((block) => block.type === "action")?.text ?? "";
  const lines = beat.blocks.filter((block) => block.type === "line");
  const notes = beat.blocks.filter((block) => block.type === "note").length;
  const cover = beat.blocks.find((block) => block.type === "image");
  const sounds = beat.blocks.filter((block) => block.type === "audio");
  const takes = lines.filter((line) => line.take !== undefined).length;
  const { files } = useServices().deps;
  // The default type is the quiet one; only other types announce themselves.
  const typeName = type !== undefined && type.id !== lookup.defaultTypeId ? type.name : null;

  const classes = ["card", selected && "is-selected", hidden && "is-hidden"]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={classes}
      data-beat-id={beat.id}
      data-swatch={type?.color ?? "bone"}
      data-status={beat.status ?? "draft"}
      aria-pressed={selected}
      onClick={() => onSelect?.(beat)}
      onPointerDown={(event) => onPointerDown?.(event, beat)}
    >
      <span className="card__head">
        <span className="card__number">{number}</span>
        {typeName !== null && <span className="card__type">{typeName}</span>}
        {beat.status !== undefined && (
          // Keyed by status so each change replays the stamp animation.
          <span key={beat.status} className="card__status" data-status={beat.status}>
            {STATUS_NAMES[beat.status]}
          </span>
        )}
        {beat.threads !== undefined && (
          <span className="card__threads">
            {beat.threads.map((threadId) => {
              const thread = lookup.entityById.get(threadId);
              return (
                <span
                  key={threadId}
                  className="card__thread"
                  data-swatch={thread?.color ?? "rose"}
                  title={thread?.name}
                />
              );
            })}
          </span>
        )}
        {beat.intensity !== undefined && (
          <span className="card__intensity" aria-label={`Tension ${beat.intensity} of 5`}>
            {[1, 2, 3, 4, 5].map((level) => (
              <span key={level} className={level <= (beat.intensity ?? 0) ? "is-on" : undefined} />
            ))}
          </span>
        )}
      </span>

      {cover !== undefined && (
        <img
          className="card__cover"
          src={files.mediaUrl(cover.src)}
          alt={cover.text}
          draggable={false}
        />
      )}
      {beat.label !== undefined && <span className="card__label">{beat.label}</span>}
      {lead !== "" && <span className="card__text">{lead}</span>}

      {lines.length > 0 && (
        <span className="card__dialogue">
          {lines.slice(0, MAX_PREVIEW_LINES).map((line) => {
            const speaker = line.speaker === null ? undefined : lookup.entityById.get(line.speaker);
            return (
              <span key={line.id} className="card__line" data-swatch={speaker?.color ?? "slate"}>
                <span className="card__speaker">{speaker?.name ?? "—"}</span>
                <span className="card__quote">{line.text || "…"}</span>
              </span>
            );
          })}
          {lines.length > MAX_PREVIEW_LINES && (
            <span className="card__more">+{lines.length - MAX_PREVIEW_LINES} more lines</span>
          )}
        </span>
      )}

      {lead === "" &&
        lines.length === 0 &&
        beat.label === undefined &&
        cover === undefined &&
        sounds.length === 0 && <span className="card__empty">Empty card</span>}

      {(notes > 0 || sounds.length > 0 || takes > 0) && (
        <span className="card__foot">
          {sounds.length > 0 && (
            <span className="card__sound" title={sounds.map((sound) => sound.text).join(", ")}>
              ♪ {sounds.length === 1 ? sounds[0]?.text || "Sound" : `${sounds.length} sounds`}
            </span>
          )}
          {takes > 0 && <span>{takes === 1 ? "1 take" : `${takes} takes`}</span>}
          {notes > 0 && <span>{notes === 1 ? "1 note" : `${notes} notes`}</span>}
        </span>
      )}
    </button>
  );
});
