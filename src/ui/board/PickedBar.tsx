import { BEAT_STATUSES, updateBeat, type BeatId, type BeatPatch, type Story } from "@core/model";
import { STATUS_NAMES } from "./status";

interface PickedBarProps {
  story: Story;
  picked: ReadonlySet<BeatId>;
  edit: (change: (story: Story) => Story) => void;
  onClear: () => void;
}

/** Shown while cards are picked with Ctrl or Shift: sets one type or status on all of them. */
export function PickedBar({ story, picked, edit, onClear }: PickedBarProps) {
  // One edit for all, so one Ctrl Z takes it back.
  const apply = (patch: BeatPatch) => {
    edit((s) => [...picked].reduce((next, id) => updateBeat(next, id, patch), s));
  };
  return (
    <div className="picked-bar" role="toolbar" aria-label="Picked cards">
      <span className="picked-bar__count">{picked.size} picked</span>
      <select
        aria-label="Set type for picked cards"
        value=""
        onChange={(event) => {
          const typeId = story.cardTypes.find((type) => type.id === event.target.value)?.id;
          if (typeId !== undefined) apply({ typeId });
        }}
      >
        <option value="" disabled>
          Set type…
        </option>
        {story.cardTypes.map((type) => (
          <option key={type.id} value={type.id}>
            {type.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Set status for picked cards"
        value=""
        onChange={(event) => {
          const status = BEAT_STATUSES.find((s) => s === event.target.value);
          if (status !== undefined) apply({ status });
        }}
      >
        <option value="" disabled>
          Set status…
        </option>
        {BEAT_STATUSES.map((status) => (
          <option key={status} value={status}>
            {STATUS_NAMES[status]}
          </option>
        ))}
      </select>
      <button type="button" className="picked-bar__clear" onClick={onClear}>
        Clear <kbd className="kbd">Esc</kbd>
      </button>
    </div>
  );
}
