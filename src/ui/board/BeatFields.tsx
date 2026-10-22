import { BEAT_STATUSES, updateBeat, type Beat, type Intensity, type Story } from "@core/model";
import { INTENSITY_NAMES } from "./intensity";
import { STATUS_NAMES } from "./status";

const INTENSITIES: readonly Intensity[] = [0, 1, 2, 3, 4, 5];

interface FieldProps {
  beat: Beat;
  story: Story;
  edit: (recipe: (story: Story) => Story, group?: string) => void;
}

export function CardTypePicker({ beat, story, edit }: FieldProps) {
  return (
    <div className="type-picker" role="radiogroup" aria-label="Card type">
      {story.cardTypes.map((type) => (
        <button
          key={type.id}
          type="button"
          role="radio"
          aria-checked={beat.typeId === type.id}
          className="type-picker__item"
          data-swatch={type.color}
          onClick={() => {
            edit((s) => updateBeat(s, beat.id, { typeId: type.id }));
          }}
        >
          <span className="swatch-dot" />
          {type.name}
        </button>
      ))}
    </div>
  );
}

/** Draft → Review → Final. The S key on the board steps a card through the same states. */
export function StatusPicker({ beat, edit }: Omit<FieldProps, "story">) {
  const current = beat.status ?? "draft";
  return (
    <div className="status-picker" role="radiogroup" aria-label="Status">
      {BEAT_STATUSES.map((status) => (
        <button
          key={status}
          type="button"
          role="radio"
          aria-checked={current === status}
          className="status-picker__item"
          data-status={status}
          onClick={() => {
            edit((s) => updateBeat(s, beat.id, { status }));
          }}
        >
          {STATUS_NAMES[status]}
        </button>
      ))}
    </div>
  );
}

export function TensionPicker({ beat, edit }: Omit<FieldProps, "story">) {
  return (
    <div className="tension-field">
      <div className="tension" role="radiogroup" aria-label="Tension">
        {INTENSITIES.map((level) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={beat.intensity === level}
            aria-label={INTENSITY_NAMES[level]}
            title={INTENSITY_NAMES[level]}
            className={`tension__bar ${(beat.intensity ?? -1) >= level ? "is-on" : ""}`}
            style={{ height: `${8 + level * 4}px` }}
            onClick={() => {
              edit((s) =>
                updateBeat(s, beat.id, { intensity: beat.intensity === level ? null : level }),
              );
            }}
          />
        ))}
      </div>
      <span className="tension-field__value">
        {beat.intensity === undefined ? "Not set" : INTENSITY_NAMES[beat.intensity]}
      </span>
    </div>
  );
}

export function HeadingInput({
  beat,
  edit,
  className = "inspector__heading",
}: Omit<FieldProps, "story"> & { className?: string }) {
  return (
    <input
      className={className}
      aria-label="Card heading"
      value={beat.label ?? ""}
      placeholder="Untitled card"
      onChange={(event) => {
        const label = event.target.value;
        edit((s) => updateBeat(s, beat.id, { label }), `label:${beat.id}`);
      }}
    />
  );
}
