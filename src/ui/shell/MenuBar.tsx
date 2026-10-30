import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { closeStory, exportStory, newStory, openStory, save } from "@app/commands";
import { liveUndo } from "@app/live/project";
import { editStory, redo, undo } from "@app/store";
import { openReleaseNotes } from "@app/updates";
import { toggleFullscreen } from "@app/window";
import { setStorySettings } from "@core/model";
import { useStore } from "@ui/hooks/use-store";
import { useServices } from "@ui/services/use-services";

interface Item {
  readonly label: string;
  readonly keys?: string;
  readonly run: () => unknown;
  readonly disabled?: boolean;
  readonly checked?: boolean;
  /** Starts a new group, with a line above it. */
  readonly group?: boolean;
}

interface MenuBarProps {
  onFocus: (() => void) | null;
  onShowSettings: () => void;
  onShowShortcuts: () => void;
  onShowWhatsNew: () => void;
}

/** The app's menus, in the title bar, working the way menus do on a desktop. */
export function MenuBar({
  onFocus,
  onShowSettings,
  onShowShortcuts,
  onShowWhatsNew,
}: MenuBarProps) {
  const { deps } = useServices();
  const { document } = deps;
  const hasStory = useStore(document, (s) => s.story !== null);
  const safeAudio = useStore(document, (s) => s.story?.settings?.safeAudio === true);
  const [open, setOpen] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const undoOrRedo = (again: boolean) => {
    // In a live session only this person's own edits are undone, never a friend's.
    if (liveUndo(again)) return;
    if (again) redo(document);
    else undo(document);
  };

  const menus: readonly { name: string; items: readonly Item[] }[] = [
    {
      name: "File",
      items: [
        { label: "New story", keys: "Ctrl N", run: () => newStory(deps) },
        { label: "Open…", keys: "Ctrl O", run: () => openStory(deps) },
        { label: "Save", keys: "Ctrl S", run: () => save(deps), disabled: !hasStory, group: true },
        {
          label: "Save as…",
          keys: "Ctrl Shift S",
          run: () => save(deps, { saveAs: true }),
          disabled: !hasStory,
        },
        {
          label: "Export voice lines",
          run: () => exportStory(deps, "voice-lines"),
          disabled: !hasStory,
          group: true,
        },
        {
          label: "Export final voice lines",
          run: () => exportStory(deps, "final-voice-lines"),
          disabled: !hasStory,
        },
        { label: "Export script", run: () => exportStory(deps, "script"), disabled: !hasStory },
        { label: "Close story", run: () => closeStory(deps), disabled: !hasStory, group: true },
      ],
    },
    {
      name: "Edit",
      items: [
        { label: "Undo", keys: "Ctrl Z", run: () => undoOrRedo(false), disabled: !hasStory },
        { label: "Redo", keys: "Ctrl Y", run: () => undoOrRedo(true), disabled: !hasStory },
      ],
    },
    {
      name: "View",
      items: [
        { label: "Focus mode", keys: "F5", run: () => onFocus?.(), disabled: onFocus === null },
        { label: "Full screen", keys: "F11", run: toggleFullscreen },
      ],
    },
    {
      name: "Settings",
      items: [
        {
          label: "Safe audio mode",
          checked: safeAudio,
          disabled: !hasStory,
          run: () => {
            editStory(document, (s) => setStorySettings(s, { safeAudio: !safeAudio }));
          },
        },
        { label: "All settings…", run: onShowSettings, disabled: !hasStory, group: true },
      ],
    },
    {
      name: "Help",
      items: [
        { label: "Keyboard shortcuts", keys: "?", run: onShowShortcuts },
        { label: "What's new", run: onShowWhatsNew },
        { label: "All release notes", run: () => openReleaseNotes(), group: true },
      ],
    },
  ];

  useEffect(() => {
    if (open === null) return undefined;
    const closeOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null);
    };
    window.addEventListener("mousedown", closeOutside);
    rootRef.current?.querySelector<HTMLElement>(".menubar__item:not(:disabled)")?.focus();
    return () => {
      window.removeEventListener("mousedown", closeOutside);
    };
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (open === null) return;
    // Handled here: these keys must not also reach the board behind the menu.
    event.stopPropagation();
    const at = menus.findIndex((menu) => menu.name === open);
    if (event.key === "Escape") {
      setOpen(null);
    } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const step = event.key === "ArrowRight" ? 1 : menus.length - 1;
      setOpen(menus[(at + step) % menus.length]?.name ?? null);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const items = [
        ...(rootRef.current?.querySelectorAll<HTMLElement>(".menubar__item:not(:disabled)") ?? []),
      ];
      const now = items.indexOf(event.target as HTMLElement);
      const step = event.key === "ArrowDown" ? 1 : items.length - 1;
      items[(now + step) % items.length]?.focus();
    }
  };

  return (
    <div ref={rootRef} className="menubar" role="menubar" onKeyDown={onKeyDown}>
      {menus.map((menu) => (
        <div key={menu.name} className="menubar__menu">
          <button
            type="button"
            role="menuitem"
            className={`menubar__name ${open === menu.name ? "is-open" : ""}`}
            aria-haspopup="menu"
            aria-expanded={open === menu.name}
            onClick={() => {
              setOpen(open === menu.name ? null : menu.name);
            }}
            // With one menu open, pointing at the next opens it, as on any desktop.
            onPointerEnter={() => {
              if (open !== null) setOpen(menu.name);
            }}
          >
            {menu.name}
          </button>
          {open === menu.name && (
            <div className="menubar__list" role="menu" aria-label={menu.name}>
              {menu.items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                  aria-checked={item.checked}
                  className={`menubar__item ${item.group === true ? "is-grouped" : ""}`}
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(null);
                    void item.run();
                  }}
                >
                  <span className="menubar__check" aria-hidden="true">
                    {item.checked === true ? "✓" : ""}
                  </span>
                  <span className="menubar__label">{item.label}</span>
                  {item.keys !== undefined && <span className="menubar__keys">{item.keys}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
