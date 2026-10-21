import { useEffect, type PointerEvent as ReactPointerEvent } from "react";

import {
  deleteBeat,
  mergeBeatWithPrevious,
  splitPhaseAt,
  type BeatLocation,
  type Story,
} from "@core/model";
import { CardTypePicker, HeadingInput, TensionPicker } from "./BeatFields";
import { ScriptEditor } from "./ScriptEditor";

interface InspectorProps {
  location: BeatLocation;
  story: Story;
  /** Put the cursor in the first block straight away, e.g. for a card just inserted. */
  autoFocus: boolean;
  edit: (recipe: (story: Story) => Story, group?: string) => void;
  onClose: () => void;
  onResizeStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onResizeBy: (delta: number) => void;
  onResizeReset: () => void;
}

/** One card in full: heading, type, tension and its script. */
export function Inspector({
  location,
  story,
  autoFocus,
  edit,
  onClose,
  onResizeStart,
  onResizeBy,
  onResizeReset,
}: InspectorProps) {
  const { beat, phase, phaseIndex, beatIndex } = location;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <aside className="inspector" aria-label={`Card ${phaseIndex + 1}.${beatIndex + 1}`}>
      <div
        className="inspector__resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        onPointerDown={onResizeStart}
        onDoubleClick={onResizeReset}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") onResizeBy(24);
          if (event.key === "ArrowRight") onResizeBy(-24);
        }}
      />

      <header className="inspector__head">
        <span className="inspector__crumb">
          <span className="inspector__number">
            {phaseIndex + 1}.{beatIndex + 1}
          </span>
          {phase.title}
        </span>
        <button type="button" className="inspector__close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>

      <div className="inspector__body">
        <HeadingInput beat={beat} edit={edit} />
        <CardTypePicker beat={beat} story={story} edit={edit} />

        <div className="inspector__field">
          <span className="inspector__label">Tension</span>
          <TensionPicker beat={beat} edit={edit} />
        </div>

        <div className="inspector__field">
          <span className="inspector__label">Script</span>
          <ScriptEditor beat={beat} story={story} edit={edit} autoFocus={autoFocus} />
        </div>
      </div>

      <footer className="inspector__actions">
        {beatIndex > 0 && (
          <>
            <button
              type="button"
              className="inspector__action"
              onClick={() => {
                edit((s) => splitPhaseAt(s, beat.id));
              }}
            >
              New phase from here
            </button>
            <button
              type="button"
              className="inspector__action"
              onClick={() => {
                edit((s) => mergeBeatWithPrevious(s, beat.id));
                onClose();
              }}
            >
              Merge into previous
            </button>
          </>
        )}
        <button
          type="button"
          className="inspector__action inspector__action--danger"
          onClick={() => {
            edit((s) => deleteBeat(s, beat.id));
            onClose();
          }}
        >
          Delete card
        </button>
      </footer>
    </aside>
  );
}
