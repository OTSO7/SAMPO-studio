import { useEffect } from "react";

import { Kbd } from "@ui/primitives/Kbd";

const GROUPS: readonly { title: string; items: readonly [string, readonly string[]][] }[] = [
  {
    title: "Story",
    items: [
      ["New story", ["Ctrl", "N"]],
      ["Open", ["Ctrl", "O"]],
      ["Save", ["Ctrl", "S"]],
      ["Save as", ["Ctrl", "Shift", "S"]],
      ["Paste a script as a new story", ["Ctrl", "V"]],
      ["Undo / redo", ["Ctrl", "Z"]],
      ["Find anything", ["Ctrl", "K"]],
      ["Present (Focus)", ["F5"]],
      ["Full screen", ["F11"]],
    ],
  },
  {
    title: "Board",
    items: [
      ["Select the next card", ["←", "↑", "↓", "→"]],
      ["Move the selected card", ["Alt", "Arrows"]],
      ["Write in the selected card", ["Enter"]],
      ["Step status: draft, review, final", ["S"]],
      ["Delete the selected card", ["Delete"]],
      ["Zoom around the pointer", ["Alt", "Scroll"]],
      ["Scroll sideways", ["Ctrl", "Scroll"]],
      ["Zoom in / out / reset", ["Ctrl", "+ − 0"]],
      ["Close the card panel", ["Esc"]],
    ],
  },
  {
    title: "Writing dialogue",
    items: [
      ["Next line, speakers alternate", ["Ctrl", "Enter"]],
      ["Switch speaker", ["Alt", "1–9"]],
      ["Remove an empty block", ["Backspace"]],
    ],
  },
  {
    title: "Focus mode",
    items: [
      ["Next / previous phase", ["→", "←"]],
      ["First / last phase", ["Home", "End"]],
      ["Exit", ["Esc"]],
    ],
  },
];

/** Every shortcut in one place. Opens with ? or F1. */
export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onClose]);

  return (
    <div
      className="sheet-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="sheet shortcuts" role="dialog" aria-modal="true" aria-label="Shortcuts">
        <header className="sheet__head">
          <h2 className="sheet__title">Keyboard shortcuts</h2>
          <button type="button" className="sheet__close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="sheet__body shortcuts__body">
          {GROUPS.map((group) => (
            <section key={group.title} className="shortcuts__group">
              <h3 className="shortcuts__title">{group.title}</h3>
              <dl className="shortcuts__list">
                {group.items.map(([label, keys]) => (
                  <div key={label} className="shortcuts__row">
                    <dt>{label}</dt>
                    <dd>
                      <Kbd keys={keys} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}
