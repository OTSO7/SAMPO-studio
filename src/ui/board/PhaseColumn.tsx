import { Fragment, memo, type PointerEvent } from "react";

import type { Beat, BeatId, Phase } from "@core/model";
import { EditableText } from "@ui/primitives/EditableText";
import { BeatCard } from "./BeatCard";
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
  onSelect: (beat: Beat) => void;
  onRename: (phase: Phase, title: string) => void;
  onRelocate: (phase: Phase, location: string) => void;
  onSplitAt: (beat: Beat) => void;
  onMergeWithPrevious: ((phase: Phase) => void) | null;
  onDelete: (phase: Phase) => void;
  onInsert: (phase: Phase, index: number, kind: InsertKind) => void;
  onCardPointerDown: (event: PointerEvent<HTMLElement>, beat: Beat, phase: Phase) => void;
}

export const PhaseColumn = memo(function PhaseColumn({
  phase,
  number,
  lookup,
  selectedBeatId,
  dragging,
  dropTarget,
  onSelect,
  onRename,
  onRelocate,
  onSplitAt,
  onMergeWithPrevious,
  onDelete,
  onInsert,
  onCardPointerDown,
}: PhaseColumnProps) {
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
                  hidden={isDragged}
                  onSelect={onSelect}
                  onPointerDown={(event) => {
                    onCardPointerDown(event, beat, phase);
                  }}
                />
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
