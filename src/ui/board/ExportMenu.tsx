import { useEffect, useRef, useState } from "react";

import { exportStory, type ExportKind } from "@app/commands";
import { useServices } from "@ui/services/use-services";

const ITEMS: readonly { kind: ExportKind; label: string; hint: string }[] = [
  { kind: "voice-lines", label: "Voice lines", hint: "CSV of every line" },
  { kind: "final-voice-lines", label: "Final voice lines", hint: "CSV of lines ready to record" },
  { kind: "script", label: "Script", hint: "Markdown to read or print" },
];

export function ExportMenu() {
  const { deps } = useServices();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === "Escape"
          : !rootRef.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="menu">
      <button
        type="button"
        className="board__tool"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        Export ▾
      </button>
      {open && (
        <div className="menu__list" role="menu">
          {ITEMS.map((item) => (
            <button
              key={item.kind}
              type="button"
              role="menuitem"
              className="menu__item"
              onClick={() => {
                setOpen(false);
                void exportStory(deps, item.kind);
              }}
            >
              <span>{item.label}</span>
              <span className="menu__hint">{item.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
