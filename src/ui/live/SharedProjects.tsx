import { useEffect, useRef, useState } from "react";

import { openProject, peekProject, removeProjectFromList } from "@app/live/project";
import { projects, type ProjectRecord } from "@app/live/projects";
import { useStore } from "@ui/hooks/use-store";
import { useServices } from "@ui/services/use-services";

import "./live.css";

const opened = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
/** How often the start screen asks who is in each project. */
const PEEK_MS = 30_000;

/** Who is working on each project now, refreshed while the start screen is showing. */
function useWhoIsHere(records: readonly ProjectRecord[]): ReadonlyMap<string, readonly string[]> {
  const [here, setHere] = useState<ReadonlyMap<string, readonly string[]>>(new Map());
  const ids = records.map((record) => record.id).join(",");
  useEffect(() => {
    let stopped = false;
    const ask = () => {
      for (const record of records) {
        void peekProject(record).then((names) => {
          if (stopped || names === null) return;
          setHere((current) => new Map(current).set(record.id, names));
        });
      }
    };
    ask();
    const timer = window.setInterval(ask, PEEK_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
    // The list is re-read from storage on every render; its ids say when it really changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);
  return here;
}

/** The start screen's shared projects: yours and the ones friends let you into. */
export function SharedProjects() {
  const { deps } = useServices();
  const list = useStore(projects, (s) => s.list);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const ready = list.filter((record) => record.storyId !== "");
  const here = useWhoIsHere(ready);
  if (ready.length === 0) return null;

  return (
    <div className="start__panel">
      <p className="start__eyebrow start__eyebrow--secondary">Shared</p>
      <ul className="start__recent">
        {ready.map((record) => (
          <li key={record.id} className="shared__item">
            <button
              type="button"
              className="start__file"
              onClick={() => void openProject(deps, record)}
            >
              <span className="start__file-name">
                {record.title || "Untitled"}
                <span className="shared__badge">Shared</span>
              </span>
              <span className="start__file-folder">
                {record.role === "owner" ? "You own this" : `Owner: ${record.ownerName || "?"}`} ·
                opened {opened.format(record.openedAt)}
              </span>
              {(here.get(record.id)?.length ?? 0) > 0 && (
                <span className="shared__here">
                  <span className="live__dot" aria-hidden="true" />
                  Working now: {here.get(record.id)?.join(", ")}
                </span>
              )}
            </button>
            <button
              type="button"
              className="shared__more"
              aria-label={`More for ${record.title || "Untitled"}`}
              aria-haspopup="menu"
              aria-expanded={menuFor === record.id}
              onMouseDown={(event) => {
                // Keeps this click from counting as a click outside the open menu.
                event.stopPropagation();
              }}
              onClick={() => {
                setMenuFor(menuFor === record.id ? null : record.id);
              }}
            >
              ⋯
            </button>
            {menuFor === record.id && (
              <ProjectMenu
                record={record}
                onClose={() => {
                  setMenuFor(null);
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProjectMenu({ record, onClose }: { record: ProjectRecord; onClose: () => void }) {
  const { deps, prompts } = useServices();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ref.current?.querySelector("button")?.focus();
    const close = (event: Event) => {
      const outside = !ref.current?.contains(event.target as Node);
      if (event instanceof KeyboardEvent ? event.key === "Escape" : outside) onClose();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [onClose]);

  const owner = record.role === "owner";
  return (
    <div ref={ref} className="shared__menu menu__list" role="menu">
      <button
        type="button"
        role="menuitem"
        className="menu__item"
        onClick={() => {
          onClose();
          void openProject(deps, record);
        }}
      >
        Open
      </button>
      <button
        type="button"
        role="menuitem"
        className="menu__item menu__item--danger"
        onClick={() => {
          onClose();
          void removeProjectFromList(deps, prompts, record);
        }}
      >
        {owner ? "Delete for everyone…" : "Leave project…"}
        <span className="menu__hint">
          {owner ? "Removes it from everyone's start screen" : "Removes it from your start screen"}
        </span>
      </button>
    </div>
  );
}
