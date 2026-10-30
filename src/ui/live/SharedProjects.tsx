import { useEffect, useRef, useState } from "react";

import { openProject, peekProject, removeProjectFromList } from "@app/live/project";
import { projects, type ProjectRecord } from "@app/live/projects";
import { useStore } from "@ui/hooks/use-store";
import { Icon, LIST_LIMIT } from "@ui/primitives/StartIcon";
import { useServices } from "@ui/services/use-services";

import "./live.css";

const opened = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
/** How often the start screen asks who is in each project. */
const PEEK_MS = 60_000;

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
  const [showAll, setShowAll] = useState(false);
  const ready = list.filter((record) => record.storyId !== "");
  const here = useWhoIsHere(ready);
  if (ready.length === 0) return null;
  const shown = showAll ? ready : ready.slice(0, LIST_LIMIT);

  return (
    <section className="start__section" aria-label="Shared projects">
      <h2 className="start__heading">Shared</h2>
      <ul className="start__list">
        {shown.map((record) => {
          const working = here.get(record.id) ?? [];
          return (
            <li key={record.id} className="shared__item">
              <button
                type="button"
                className="start__row"
                title={
                  record.role === "owner"
                    ? "You own this project"
                    : `${record.ownerName || "?"}'s project`
                }
                onClick={() => void openProject(deps, record)}
              >
                <Icon name="people" />
                <span className="start__row-name">{record.title || "Untitled"}</span>
                {working.length > 0 ? (
                  <span className="start__row-meta shared__here">
                    <span className="live__dot" aria-hidden="true" />
                    {working.join(", ")} now
                  </span>
                ) : (
                  <span className="start__row-meta">
                    {record.role === "owner" ? "Yours" : record.ownerName || "?"} ·{" "}
                    {opened.format(record.openedAt)}
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
          );
        })}
      </ul>
      {ready.length > LIST_LIMIT && (
        <button
          type="button"
          className="start__more"
          onClick={() => {
            setShowAll((all) => !all);
          }}
        >
          {showAll ? "Show fewer" : `Show all ${ready.length}`}
        </button>
      )}
    </section>
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
