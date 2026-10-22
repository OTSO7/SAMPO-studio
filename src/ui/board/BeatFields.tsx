import {
  BEAT_STATUSES,
  ensureThread,
  toggleThread,
  updateBeat,
  type Beat,
  type Intensity,
  type Story,
} from "@core/model";
import { INTENSITY_NAMES } from "./intensity";
import { SpeakerCombo } from "./SpeakerCombo";
import { STATUS_NAMES } from "./status";

const INTENSITIES: readonly Intensity[] = [0, 1, 2, 3, 4, 5];

interface FieldProps {
  beat: Beat;
  story: Story;
  edit: (recipe: (story: Story) => Story, group?: string) => void;
}

/** One compact control, however many types a story defines; its colour dot is the card's. */
export function CardTypePicker({ beat, story, edit }: FieldProps) {
  const current = story.cardTypes.find((type) => type.id === beat.typeId);
  return (
    <label className="type-select" data-swatch={current?.color ?? "bone"}>
      <span className="swatch-dot" aria-hidden="true" />
      <select
        aria-label="Card type"
        value={beat.typeId}
        onChange={(event) => {
          const typeId = story.cardTypes.find((type) => type.id === event.target.value)?.id;
          if (typeId !== undefined) edit((s) => updateBeat(s, beat.id, { typeId }));
        }}
      >
        {story.cardTypes.map((type) => (
          <option key={type.id} value={type.id}>
            {type.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The story threads this card belongs to. Pick one or type a new name; no tags to type, no
 * list to maintain: a thread exists while a card is pinned to it.
 */
export function ThreadsField({ beat, story, edit }: FieldProps) {
  const threads = story.entities.filter((entity) => entity.kind === "thread");
  const pinned = threads.filter((thread) => beat.threads?.includes(thread.id) === true);
  return (
    <div className="threads-field">
      {pinned.map((thread) => (
        <span key={thread.id} className="thread-chip" data-swatch={thread.color ?? "rose"}>
          <span className="swatch-dot" aria-hidden="true" />
          {thread.name}
          <button
            type="button"
            className="thread-chip__remove"
            aria-label={`Unpin from ${thread.name}`}
            title="Unpin"
            onClick={() => {
              edit((s) => toggleThread(s, beat.id, thread.id));
            }}
          >
            ×
          </button>
        </span>
      ))}
      <SpeakerCombo
        value={null}
        characters={threads.filter((thread) => !pinned.includes(thread))}
        label="Add a story thread"
        placeholder="+ Thread"
        noun="thread"
        onSelect={(threadId) => {
          edit((s) => toggleThread(s, beat.id, threadId));
        }}
        onCreate={(name) => {
          edit((s) => {
            const { story: withThread, entityId } = ensureThread(s, name);
            return toggleThread(withThread, beat.id, entityId);
          });
        }}
      />
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
