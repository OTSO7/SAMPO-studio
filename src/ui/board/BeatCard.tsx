import { memo, useLayoutEffect, useRef, type MouseEvent, type PointerEvent } from "react";

import { mediaArrivals } from "@app/live/project";
import type { Beat } from "@core/model";
import { useStore } from "@ui/hooks/use-store";
import { useServices } from "@ui/services/use-services";
import { MAX_PREVIEW_LINES } from "./card-preview";
import { STATUS_NAMES } from "./status";
import type { StoryLookup } from "./story-lookup";

interface BeatCardProps {
  beat: Beat;
  number: string;
  lookup: StoryLookup;
  selected?: boolean;
  /** One of several cards picked with Ctrl or Shift. */
  picked?: boolean;
  hidden?: boolean;
  /** Shows every line and the whole text instead of a preview. */
  expanded?: boolean;
  /** `add` is true for a Ctrl or Shift click, which picks the card alongside others. */
  onSelect?: (beat: Beat, add: boolean) => void;
  onPointerDown?: (event: PointerEvent<HTMLElement>, beat: Beat) => void;
  onContextMenu?: (event: MouseEvent<HTMLElement>, beat: Beat) => void;
  /** Told whether the collapsed card cuts any text off, measured as it is drawn. */
  onClipped?: (beatId: Beat["id"], clipped: boolean) => void;
}

/** A card on the board: number, first picture, heading, opening text and dialogue. */
export const BeatCard = memo(function BeatCard({
  beat,
  number,
  lookup,
  selected = false,
  picked = false,
  hidden = false,
  expanded = false,
  onSelect,
  onPointerDown,
  onContextMenu,
  onClipped,
}: BeatCardProps) {
  const ref = useRef<HTMLButtonElement | null>(null);
  // Measured, not guessed: line breaks, long words and the zoom all change what fits.
  useLayoutEffect(() => {
    const card = ref.current;
    if (card === null || onClipped === undefined || expanded) return undefined;
    const check = () => {
      const clamped = card.querySelectorAll<HTMLElement>(".card__text, .card__quote, .card__label");
      const cut = [...clamped].some((el) => el.scrollHeight > el.clientHeight + 1);
      onClipped(beat.id, cut || card.querySelector(".card__more") !== null);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(card);
    return () => {
      observer.disconnect();
    };
  }, [beat, expanded, onClipped]);
  const type = lookup.typeById.get(beat.typeId);
  const lead = beat.blocks.find((block) => block.type === "action")?.text ?? "";
  const lines = beat.blocks.filter((block) => block.type === "line");
  const notes = beat.blocks.filter((block) => block.type === "note").length;
  const cover = beat.blocks.find((block) => block.type === "image");
  const sounds = beat.blocks.filter((block) => block.type === "audio" && block.role !== "sfx");
  const effects = beat.blocks.filter((block) => block.type === "audio" && block.role === "sfx");
  const takes = lines.filter((line) => line.take !== undefined).length;
  const { files } = useServices().deps;
  const arrivals = useStore(mediaArrivals, (s) => s.count);
  // Every type is named: authors define them, so the first one means something too.
  const typeName = type?.name ?? null;
  const shownLines = expanded ? lines : lines.slice(0, MAX_PREVIEW_LINES);

  const classes = [
    "card",
    selected && "is-selected",
    picked && "is-picked",
    hidden && "is-hidden",
    expanded && "is-expanded",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      ref={ref}
      type="button"
      className={classes}
      data-beat-id={beat.id}
      data-swatch={type?.color ?? "bone"}
      data-status={beat.status ?? "draft"}
      aria-pressed={selected}
      onClick={(event) => onSelect?.(beat, event.ctrlKey || event.metaKey || event.shiftKey)}
      onPointerDown={(event) => onPointerDown?.(event, beat)}
      onContextMenu={(event) => onContextMenu?.(event, beat)}
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
            {[0, 1, 2, 3, 4, 5].map((level) => (
              <span key={level} className={level <= (beat.intensity ?? 0) ? "is-on" : undefined} />
            ))}
          </span>
        )}
      </span>

      {cover !== undefined && (
        <img
          key={arrivals}
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
          {shownLines.map((line) => {
            const speaker = line.speaker === null ? undefined : lookup.entityById.get(line.speaker);
            return (
              <span key={line.id} className="card__line" data-swatch={speaker?.color ?? "slate"}>
                <span className="card__speaker">{speaker?.name ?? "—"}</span>
                <span className="card__quote">{line.text || "…"}</span>
              </span>
            );
          })}
          {lines.length > shownLines.length && (
            <span className="card__more" title="Right-click the card to expand it">
              +{lines.length - shownLines.length} more lines
            </span>
          )}
        </span>
      )}

      {lead === "" &&
        lines.length === 0 &&
        beat.label === undefined &&
        cover === undefined &&
        sounds.length === 0 &&
        effects.length === 0 && <span className="card__empty">Empty card</span>}

      {(notes > 0 || sounds.length > 0 || effects.length > 0 || takes > 0) && (
        <span className="card__foot">
          {sounds.length > 0 && (
            <span className="card__sound" title={sounds.map((sound) => sound.text).join(", ")}>
              ♪ {sounds.length === 1 ? sounds[0]?.text || "Sound" : `${sounds.length} sounds`}
            </span>
          )}
          {effects.length > 0 && (
            <span className="card__sound" title={effects.map((effect) => effect.text).join(", ")}>
              SFX {effects.length === 1 ? effects[0]?.text || "Effect" : `× ${effects.length}`}
            </span>
          )}
          {takes > 0 && <span>{takes === 1 ? "1 take" : `${takes} takes`}</span>}
          {notes > 0 && <span>{notes === 1 ? "1 note" : `${notes} notes`}</span>}
        </span>
      )}
    </button>
  );
});
