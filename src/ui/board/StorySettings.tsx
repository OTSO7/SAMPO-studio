import { useEffect, useState } from "react";

import {
  addCardType,
  ensureCharacter,
  moveCardType,
  removeCardType,
  removeEntity,
  SWATCHES,
  updateCardType,
  updateEntity,
  type Story,
  type Swatch,
} from "@core/model";

interface StorySettingsProps {
  story: Story;
  edit: (recipe: (story: Story) => Story, group?: string) => void;
  onClose: () => void;
}

/** Card types and characters for this story: names, colours and how much each is used. */
export function StorySettings({ story, edit, onClose }: StorySettingsProps) {
  const beats = story.phases.flatMap((phase) => phase.beats);
  const cardsOfType = (typeId: string) => beats.filter((beat) => beat.typeId === typeId).length;
  const linesOf = (entityId: string) =>
    beats
      .flatMap((beat) => beat.blocks)
      .filter((block) => block.type === "line" && block.speaker === entityId).length;
  const characters = story.entities.filter((entity) => entity.kind === "character");

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
    <div
      className="sheet-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="sheet" role="dialog" aria-modal="true" aria-label="Card types and cast">
        <header className="sheet__head">
          <h2 className="sheet__title">Card types &amp; cast</h2>
          <button type="button" className="sheet__close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="sheet__body">
          <section className="sheet__section">
            <div className="sheet__section-head">
              <h3>Card types</h3>
              <p>The first type is the default for new cards.</p>
            </div>
            <ul className="settings-list">
              {story.cardTypes.map((type, index) => (
                <li key={type.id} className="settings-row" data-swatch={type.color}>
                  <SwatchPicker
                    value={type.color}
                    onChange={(color) => {
                      edit((s) => updateCardType(s, type.id, { color }));
                    }}
                  />
                  <input
                    className="settings-row__name"
                    aria-label="Type name"
                    value={type.name}
                    onChange={(event) => {
                      const name = event.target.value;
                      edit((s) => updateCardType(s, type.id, { name }), `type:${type.id}`);
                    }}
                  />
                  <span className="settings-row__count">
                    {cardsOfType(type.id)} {cardsOfType(type.id) === 1 ? "card" : "cards"}
                  </span>
                  <span className="settings-row__tools">
                    <button
                      type="button"
                      aria-label="Move up"
                      disabled={index === 0}
                      onClick={() => {
                        edit((s) => moveCardType(s, type.id, -1));
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label="Move down"
                      disabled={index === story.cardTypes.length - 1}
                      onClick={() => {
                        edit((s) => moveCardType(s, type.id, 1));
                      }}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label="Remove type"
                      title={
                        story.cardTypes.length === 1
                          ? "A story needs at least one card type"
                          : "Remove; its cards move to the default type"
                      }
                      disabled={story.cardTypes.length === 1}
                      onClick={() => {
                        edit((s) => removeCardType(s, type.id));
                      }}
                    >
                      ×
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <AddRow
              placeholder="New card type"
              onAdd={(name) => {
                edit((s) => addCardType(s, name).story);
              }}
            />
          </section>

          <section className="sheet__section">
            <div className="sheet__section-head">
              <h3>Cast</h3>
              <p>Characters who speak. Removing one keeps their lines, unattributed.</p>
            </div>
            {characters.length === 0 ? (
              <p className="settings-empty">No characters yet. Add one here or from any line.</p>
            ) : (
              <ul className="settings-list">
                {characters.map((entity) => (
                  <li
                    key={entity.id}
                    className="settings-row"
                    data-swatch={entity.color ?? "slate"}
                  >
                    <SwatchPicker
                      value={entity.color ?? "slate"}
                      onChange={(color) => {
                        edit((s) => updateEntity(s, entity.id, { color }));
                      }}
                    />
                    <input
                      className="settings-row__name"
                      aria-label="Character name"
                      value={entity.name}
                      onChange={(event) => {
                        const name = event.target.value;
                        edit((s) => updateEntity(s, entity.id, { name }), `entity:${entity.id}`);
                      }}
                    />
                    <span className="settings-row__count">
                      {linesOf(entity.id)} {linesOf(entity.id) === 1 ? "line" : "lines"}
                    </span>
                    <span className="settings-row__tools">
                      <button
                        type="button"
                        aria-label="Remove character"
                        onClick={() => {
                          edit((s) => removeEntity(s, entity.id));
                        }}
                      >
                        ×
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <AddRow
              placeholder="New character"
              onAdd={(name) => {
                edit((s) => ensureCharacter(s, name).story);
              }}
            />
          </section>
        </div>
      </section>
    </div>
  );
}

function SwatchPicker({ value, onChange }: { value: Swatch; onChange: (swatch: Swatch) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="swatch-picker">
      <button
        type="button"
        className="swatch-picker__current"
        aria-label={`Colour: ${value}`}
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <span className="swatch-dot" />
      </button>
      {open && (
        <span className="swatch-picker__menu" role="listbox" aria-label="Colour">
          {SWATCHES.map((swatch) => (
            <button
              key={swatch}
              type="button"
              role="option"
              aria-selected={swatch === value}
              aria-label={swatch}
              data-swatch={swatch}
              className="swatch-picker__option"
              onClick={() => {
                onChange(swatch);
                setOpen(false);
              }}
            >
              <span className="swatch-dot" />
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

function AddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (name: string) => void }) {
  const [name, setName] = useState("");
  const submit = () => {
    if (name.trim() === "") return;
    onAdd(name.trim());
    setName("");
  };
  return (
    <form
      className="settings-add"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <input
        value={name}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      <button type="submit" disabled={name.trim() === ""}>
        Add
      </button>
    </form>
  );
}
