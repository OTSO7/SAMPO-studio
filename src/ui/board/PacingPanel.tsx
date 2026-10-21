import type { BeatId, Story } from "@core/model";
import { usePanelHeight } from "@ui/hooks/use-panel-height";
import { PacingStrip } from "./PacingStrip";

interface PacingPanelProps {
  story: Story;
  open: boolean;
  selectedBeatId: BeatId | null;
  edit: (recipe: (story: Story) => Story, group?: string) => void;
  onSelect: (beatId: BeatId) => void;
  onToggle: () => void;
}

/**
 * The pacing chart docked under the board. Resize it from its top edge; when hidden it
 * folds into a slim bar in the same place, so it is always one click from coming back.
 */
export function PacingPanel({
  story,
  open,
  selectedBeatId,
  edit,
  onSelect,
  onToggle,
}: PacingPanelProps) {
  const panel = usePanelHeight({
    storageKey: "sampo.pacingHeight",
    initial: 168,
    min: 96,
    maxShare: 0.5,
  });

  if (!open) {
    return (
      <button type="button" className="pacing-bar" aria-expanded={false} onClick={onToggle}>
        <span aria-hidden="true">▴</span>
        Pacing
      </button>
    );
  }

  return (
    <section className="pacing" style={{ height: panel.height }} aria-label="Pacing">
      <div
        className="pacing__resizer"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize pacing"
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        onPointerDown={panel.startResize}
        onDoubleClick={panel.reset}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp") panel.resizeBy(24);
          if (event.key === "ArrowDown") panel.resizeBy(-24);
        }}
      />
      <header className="pacing__head">
        <span className="pacing__title">Pacing</span>
        <span className="pacing__hint">Drag a point to set tension · click to open the card</span>
        <button type="button" className="pacing__hide" aria-expanded={true} onClick={onToggle}>
          Hide <span aria-hidden="true">▾</span>
        </button>
      </header>
      <PacingStrip story={story} selectedBeatId={selectedBeatId} edit={edit} onSelect={onSelect} />
    </section>
  );
}
