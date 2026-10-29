import { Fragment, memo, useCallback, useState, type MouseEvent, type PointerEvent } from "react";

import type { Beat, BeatId, Phase } from "@core/model";
import { EditableText } from "@ui/primitives/EditableText";
import { BeatCard } from "./BeatCard";
import { canExpand } from "./card-preview";
import type { InsertKind } from "./insert-card";
import type { StoryLookup } from "./story-lookup";
import type { DragState, DropTarget } from "./use-card-drag";

interface PhaseColumnProps {
  phase: Phase;
  number: number;
  lookup: StoryLookup;
  selectedBeatId: BeatId | null;
  dragging: DragState | null;
  dropTarget: DropTarget | null;
  picked: ReadonlySet<BeatId>;
  onSelect: (beat: Beat, add: boolean) => void;
  onRename: (phase: Phase, title: string) => void;
  onRelocate: (phase: Phase, location: string) => void;
  onSplitAt: (beat: Beat) => void;
  onMergeWithPrevious: ((phase: Phase) => void) | null;
  onDelete: (phase: Phase) => void;
  onInsert: (phase: Phase, index: number, kind: InsertKind) => void;
  onCardPointerDown: (event: PointerEvent<HTMLElement>, beat: Beat, phase: Phase) => void;
  /** Cards shown in full on the board. */
  expandedIds: ReadonlySet<BeatId>;
  onToggleExpand: (beatId: BeatId) => void;
  onCardContextMenu: (event: MouseEvent<HTMLElement>, beat: Beat) => void;
}

export const PhaseColumn = memo(function PhaseColumn({
  phase,
  number,
  lookup,
  selectedBeatId,
  dragging,
  dropTarget,
  picked,
  onSelect,
  onRename,
  onRelocate,
  onSplitAt,
  onMergeWithPrevious,
  onDelete,
  onInsert,
  onCardPointerDown,
  expandedIds,
  onToggleExpand,
  onCardContextMenu,
}: PhaseColumnProps) {
  const [clipped, setClipped] = useState<ReadonlySet<BeatId>>(new Set());
  const onClipped = useCallback((beatId: BeatId, cut: boolean) => {
    setClipped((current) => {
      if (current.has(beatId) === cut) return current;
      const next = new Set(current);
      if (cut) next.add(beatId);
      else next.delete(beatId);
      return next;
    });
  }, []);
  const dropIndex = dragging !== null && dropTarget?.phaseId === phase.id ? dropTarget.index : null;
  const draggedIndex =
    dragging === null ? -1 : phase.beats.findIndex((beat) => beat.id === dragging.beatId);
  // Drop positions count only the cards that stay put.
  const positionOf = (index: number) =>
    draggedIndex !== -1 && index > draggedIndex ? index - 1 : index;
  const remaining = phase.beats.length - (draggedIndex === -1 ? 0 : 1);
  const placeholder = (
    <li className="column__placeholder" style={{ height: dragging?.height }} aria-hidden="true" />
  );

  return (
    <section
      className="column"
      data-phase-id={phase.id}
      aria-label={`Phase ${number}: ${phase.title}`}
    >
      <header className="column__head">
        <div className="column__title-row">
          <span className="column__number">{String(number).padStart(2, "0")}</span>
          <EditableText
            className="column__title"
            label="phase title"
            value={phase.title}
            placeholder="Untitled phase"
            onCommit={(title) => {
              onRename(phase, title);
            }}
          />
          {onMergeWithPrevious !== null && (
            <button
              type="button"
              className="column__merge"
              title="Merge into previous phase"
              aria-label="Merge into previous phase"
              onClick={() => {
                onMergeWithPrevious(phase);
              }}
            >
              ⇤
            </button>
          )}
          <button
            type="button"
            className="column__delete"
            title="Delete phase"
            aria-label={`Delete phase ${number}`}
            onClick={() => {
              onDelete(phase);
            }}
          >
            ×
          </button>
        </div>
        <EditableText
          className="column__location"
          label="location"
          value={phase.location ?? ""}
          placeholder="Add location"
          onCommit={(location) => {
            onRelocate(phase, location);
          }}
        />
      </header>

      <ol className="column__cards">
        {phase.beats.map((beat, index) => {
          const isDragged = index === draggedIndex;
          return (
            <Fragment key={beat.id}>
              {!isDragged && dropIndex === positionOf(index) && placeholder}
              <li className="column__slot">
                {dragging === null && (
                  <GapMenu
                    onInsert={(kind) => {
                      onInsert(phase, index, kind);
                    }}
                    onSplit={
                      index === 0
                        ? null
                        : () => {
                            onSplitAt(beat);
                          }
                    }
                  />
                )}
                <BeatCard
                  beat={beat}
                  number={`${number}.${index + 1}`}
                  lookup={lookup}
                  selected={beat.id === selectedBeatId}
                  picked={picked.has(beat.id)}
                  hidden={isDragged}
                  expanded={expandedIds.has(beat.id)}
                  onSelect={onSelect}
                  onPointerDown={(event) => {
                    onCardPointerDown(event, beat, phase);
                  }}
                  onContextMenu={onCardContextMenu}
                  onClipped={onClipped}
                />
                {/* Beside the card button, not inside it: a button may not hold another. */}
                {!isDragged &&
                  (canExpand(beat) || clipped.has(beat.id) || expandedIds.has(beat.id)) && (
                    <button
                      type="button"
                      className={`card__expand ${expandedIds.has(beat.id) ? "is-expanded" : ""}`}
                      aria-label={
                        expandedIds.has(beat.id) ? "Collapse the card" : "Expand the card"
                      }
                      aria-expanded={expandedIds.has(beat.id)}
                      title={expandedIds.has(beat.id) ? "Collapse" : "Show the whole card"}
                      onClick={() => {
                        onToggleExpand(beat.id);
                      }}
                    >
                      <svg viewBox="0 0 10 10" aria-hidden="true">
                        <path d="M2 3.5l3 3 3-3" />
                      </svg>
                    </button>
                  )}
              </li>
            </Fragment>
          );
        })}
        {dropIndex === remaining && placeholder}
        <li className="column__end">
          <button
            type="button"
            onClick={() => {
              onInsert(phase, phase.beats.length, "card");
            }}
          >
            + Card
          </button>
          <button
            type="button"
            onClick={() => {
              onInsert(phase, phase.beats.length, "dialogue");
            }}
          >
            + Dialogue
          </button>
        </li>
      </ol>
    </section>
  );
});

/** Appears in the gap above a card: insert something here, or start a new phase. */
function GapMenu({
  onInsert,
  onSplit,
}: {
  onInsert: (kind: InsertKind) => void;
  onSplit: (() => void) | null;
}) {
  return (
    <div className="gap">
      <span className="gap__line" aria-hidden="true" />
      <div className="gap__menu">
        <button
          type="button"
          onClick={() => {
            onInsert("card");
          }}
        >
          + Card
        </button>
        <button
          type="button"
          onClick={() => {
            onInsert("dialogue");
          }}
        >
          + Dialogue
        </button>
        {onSplit !== null && (
          <button type="button" onClick={onSplit}>
            Split phase
          </button>
        )}
      </div>
    </div>
  );
}
