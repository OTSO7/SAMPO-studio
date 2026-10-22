import { useEffect, useMemo, useRef, useState } from "react";

import type { Story } from "@core/model";
import { searchStory, type SearchResult } from "@core/search";

interface QuickFindProps {
  story: Story;
  onPick: (result: SearchResult) => void;
}

/**
 * The search field in the board header. Ctrl+K or Ctrl+F jumps into it from anywhere;
 * results drop down under it and Enter opens the highlighted one.
 */
export function QuickFind({ story, onPick }: QuickFindProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const results = useMemo(() => searchStory(story, query), [story, query]);
  const highlighted = Math.min(active, Math.max(results.length - 1, 0));
  const showResults = open && query.trim() !== "";

  // Works while typing elsewhere too, like every search box in a desktop app.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && !event.altKey && (key === "k" || key === "f")) {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const leave = () => {
    setQuery("");
    setActive(0);
    inputRef.current?.blur();
  };

  const pick = (result: SearchResult | undefined) => {
    if (result === undefined) return;
    onPick(result);
    leave();
  };

  return (
    <div className={`search ${showResults ? "is-open" : ""}`}>
      <svg className="search__icon" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="7" cy="7" r="5" />
        <path d="M11 11l4 4" />
      </svg>
      <input
        ref={inputRef}
        className="search__input"
        type="search"
        role="combobox"
        aria-label="Search the story"
        aria-expanded={showResults}
        aria-controls="search-results"
        placeholder="Search cards, lines, characters"
        value={query}
        onFocus={() => {
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            setActive((current) => Math.max(0, Math.min(results.length - 1, current + step)));
          } else if (event.key === "Enter") {
            event.preventDefault();
            pick(results[highlighted]);
          } else if (event.key === "Escape") {
            // Clears the search without also closing the open card.
            event.preventDefault();
            event.stopPropagation();
            leave();
          }
        }}
      />
      {!open && query === "" && <kbd className="kbd search__hint">Ctrl K</kbd>}

      {showResults && (
        <ul className="search__results" id="search-results" role="listbox">
          {results.length === 0 && <li className="find__empty">Nothing matches “{query}”</li>}
          {results.map((result, index) => (
            <li
              key={`${result.kind}-${result.beatId ?? result.phaseId}`}
              role="option"
              aria-selected={index === highlighted}
              className="find__result"
              onMouseEnter={() => {
                setActive(index);
              }}
              onMouseDown={(event) => {
                // Keep focus in the field so the pick is not lost to the blur.
                event.preventDefault();
                pick(result);
              }}
            >
              <span className="find__number">{result.number}</span>
              <span className="find__body">
                <span className="find__title">
                  {result.kind === "phase" ? `Phase · ${result.title}` : result.title || "Card"}
                </span>
                <span className="find__excerpt">
                  {result.excerpt.slice(0, result.matchStart)}
                  <mark>
                    {result.excerpt.slice(
                      result.matchStart,
                      result.matchStart + result.matchLength,
                    )}
                  </mark>
                  {result.excerpt.slice(result.matchStart + result.matchLength)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
