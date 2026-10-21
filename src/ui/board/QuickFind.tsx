import { useMemo, useState } from "react";

import type { Story } from "@core/model";
import { searchStory, type SearchResult } from "@core/search";

interface QuickFindProps {
  story: Story;
  onPick: (result: SearchResult) => void;
  onClose: () => void;
}

/** Ctrl+K: jump to any phase or card by typing a few letters of it. */
export function QuickFind({ story, onPick, onClose }: QuickFindProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const results = useMemo(() => searchStory(story, query), [story, query]);
  const highlighted = Math.min(active, Math.max(results.length - 1, 0));

  const pick = (result: SearchResult | undefined) => {
    if (result === undefined) return;
    onPick(result);
    onClose();
  };

  return (
    <div
      className="find-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="find" role="dialog" aria-modal="true" aria-label="Find in story">
        <input
          autoFocus
          className="find__input"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="find-results"
          placeholder="Find a card, line, character or phase…"
          value={query}
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
              event.preventDefault();
              event.stopPropagation();
              onClose();
            }
          }}
        />

        {query.trim() !== "" && (
          <ul className="find__results" id="find-results" role="listbox">
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

        <footer className="find__foot">
          <span>↑ ↓ to choose</span>
          <span>↵ to open</span>
          <span>Esc to close</span>
        </footer>
      </section>
    </div>
  );
}
