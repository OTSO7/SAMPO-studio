import { useId, useState } from "react";

import type { Entity, EntityId } from "@core/model";

interface SpeakerComboProps {
  value: EntityId | null;
  characters: readonly Entity[];
  autoFocus?: boolean;
  onSelect: (speaker: EntityId) => void;
  onCreate: (name: string) => void;
  /** Called after a choice so focus can move on to the line itself. */
  onDone?: () => void;
}

/**
 * Type-to-pick speaker field: "el" + Enter picks Elias, an unknown name + Enter adds a new
 * character. Arrow keys move through the matches.
 */
export function SpeakerCombo({
  value,
  characters,
  autoFocus,
  onSelect,
  onCreate,
  onDone,
}: SpeakerComboProps) {
  const listId = useId();
  const current = characters.find((entity) => entity.id === value);
  const [query, setQuery] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);

  const open = query !== null;
  const needle = (query ?? "").trim().toLocaleLowerCase();
  const matches = characters.filter((entity) => entity.name.toLocaleLowerCase().includes(needle));
  const exact = matches.some((entity) => entity.name.toLocaleLowerCase() === needle);
  const canCreate = needle !== "" && !exact;
  const optionCount = matches.length + (canCreate ? 1 : 0);

  const choose = (index: number) => {
    const match = matches[index];
    if (match !== undefined) onSelect(match.id);
    else if (canCreate && query !== null) onCreate(query.trim());
    setQuery(null);
    onDone?.();
  };

  return (
    <div className="speaker" data-swatch={current?.color ?? "slate"}>
      <input
        autoFocus={autoFocus}
        data-autofocus={autoFocus ? "" : undefined}
        className="speaker__input"
        role="combobox"
        aria-label="Speaker"
        aria-expanded={open}
        aria-controls={listId}
        placeholder="Speaker"
        value={open ? query : (current?.name ?? "")}
        onFocus={() => {
          setQuery("");
          setHighlight(0);
        }}
        onBlur={() => {
          setQuery(null);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setHighlight(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            setHighlight((index) => (index + step + optionCount) % Math.max(optionCount, 1));
          } else if (event.key === "Enter" || (event.key === "Tab" && needle !== "")) {
            if (optionCount === 0) return;
            event.preventDefault();
            choose(highlight);
          } else if (event.key === "Escape") {
            event.stopPropagation();
            setQuery(null);
            event.currentTarget.blur();
          }
        }}
      />
      {open && optionCount > 0 && (
        <ul className="speaker__options" id={listId} role="listbox">
          {matches.map((entity, index) => (
            <li
              key={entity.id}
              role="option"
              aria-selected={index === highlight}
              className="speaker__option"
              data-swatch={entity.color ?? "slate"}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(index);
              }}
            >
              <span className="swatch-dot" />
              {entity.name}
            </li>
          ))}
          {canCreate && (
            <li
              role="option"
              aria-selected={highlight === matches.length}
              className="speaker__option speaker__option--create"
              onMouseDown={(event) => {
                event.preventDefault();
                choose(matches.length);
              }}
            >
              + New character “{query?.trim()}”
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
