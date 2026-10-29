import { useState } from "react";

import { importScript, newStory, openStory, openStoryAt } from "@app/commands";
import { showNotice } from "@app/store";
import { JoinDialog } from "@ui/live/JoinDialog";
import { SharedProjects } from "@ui/live/SharedProjects";
import { Kbd } from "@ui/primitives/Kbd";
import { Icon, LIST_LIMIT } from "@ui/primitives/StartIcon";
import { useServices } from "@ui/services/use-services";

function splitPath(path: string): { name: string; folder: string } {
  const parts = path.split(/[\\/]/u);
  const name = parts.pop() ?? path;
  // The folder's own name tells files apart; the full path is in the tooltip.
  return { name: name.replace(/\.sampo$/iu, ""), folder: parts.pop() ?? "" };
}

export function StartScreen() {
  const { deps } = useServices();
  // Read once per visit to the start screen; opening a file leaves this screen anyway.
  const [recent] = useState(() => deps.recent?.list() ?? []);
  const [joining, setJoining] = useState(false);

  const pasteFromClipboard = async () => {
    try {
      if (!(await importScript(deps, await navigator.clipboard.readText()))) {
        showNotice(deps.notices, { tone: "info", title: "Clipboard is empty" });
      }
    } catch {
      showNotice(deps.notices, { tone: "info", title: "Press Ctrl V to paste a script" });
    }
  };

  const actions = [
    {
      icon: "plus" as const,
      label: "New story",
      hint: "Start from an empty board",
      keys: ["Ctrl", "N"],
      run: () => newStory(deps),
    },
    {
      icon: "folder" as const,
      label: "Open…",
      hint: "Pick a .sampo file",
      keys: ["Ctrl", "O"],
      run: () => openStory(deps),
    },
    {
      icon: "paste" as const,
      label: "Paste script",
      hint: "Turn a document into phases and cards",
      keys: ["Ctrl", "V"],
      run: pasteFromClipboard,
    },
    {
      icon: "people" as const,
      label: "Join a shared project",
      hint: "With the invite code a friend sent",
      keys: [],
      run: () => {
        setJoining(true);
      },
    },
  ];

  const [primary, ...secondary] = actions;
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? recent : recent.slice(0, LIST_LIMIT);

  return (
    <section className="start" aria-label="Start">
      <header className="start__hero">
        <h1 className="start__title">SAMPO Studio</h1>
      </header>

      <div className="start__body">
        <nav className="start__side" aria-label="Start something">
          {primary !== undefined && (
            <button type="button" className="start__primary" onClick={() => void primary.run()}>
              <Icon name="plus" />
              <span>{primary.label}</span>
              <Kbd keys={primary.keys} />
            </button>
          )}
          <ul className="start__links">
            {secondary.map((action) => (
              <li key={action.label}>
                <button
                  type="button"
                  className="start__link"
                  title={action.hint}
                  onClick={() => void action.run()}
                >
                  <Icon name={action.icon} />
                  <span className="start__link-label">{action.label}</span>
                  {action.keys.length > 0 && <Kbd keys={action.keys} />}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="start__work">
          {recent.length > 0 && (
            <section className="start__section" aria-label="Recent stories">
              <h2 className="start__heading">Recent</h2>
              <ul className="start__list">
                {shown.map((path) => {
                  const { name, folder } = splitPath(path);
                  return (
                    <li key={path}>
                      <button
                        type="button"
                        className="start__row"
                        title={path}
                        onClick={() => void openStoryAt(deps, path)}
                      >
                        <Icon name="file" />
                        <span className="start__row-name">{name}</span>
                        <span className="start__row-meta">{folder}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {recent.length > LIST_LIMIT && (
                <button
                  type="button"
                  className="start__more"
                  onClick={() => {
                    setShowAll((all) => !all);
                  }}
                >
                  {showAll ? "Show fewer" : `Show all ${recent.length}`}
                </button>
              )}
            </section>
          )}
          <SharedProjects />
        </div>
      </div>

      {joining && (
        <JoinDialog
          onClose={() => {
            setJoining(false);
          }}
        />
      )}
    </section>
  );
}
