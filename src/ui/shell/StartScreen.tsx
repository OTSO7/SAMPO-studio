import { useState } from "react";

import { importScript, newStory, openStory, openStoryAt } from "@app/commands";
import { showNotice } from "@app/store";
import { JoinDialog } from "@ui/live/JoinDialog";
import { SharedProjects } from "@ui/live/SharedProjects";
import { Kbd } from "@ui/primitives/Kbd";
import { useServices } from "@ui/services/use-services";

function splitPath(path: string): { name: string; folder: string } {
  const parts = path.split(/[\\/]/u);
  const name = parts.pop() ?? path;
  return { name: name.replace(/\.sampo$/iu, ""), folder: parts.join("\\") };
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
      label: "New story",
      hint: "Start from an empty board",
      keys: ["Ctrl", "N"],
      run: () => newStory(deps),
    },
    {
      label: "Open…",
      hint: "Pick a .sampo file",
      keys: ["Ctrl", "O"],
      run: () => openStory(deps),
    },
    {
      label: "Paste script",
      hint: "Turn a document into phases and cards",
      keys: ["Ctrl", "V"],
      run: pasteFromClipboard,
    },
    {
      label: "Join a shared project",
      hint: "With the invite code a friend sent",
      keys: [],
      run: () => {
        setJoining(true);
      },
    },
  ];

  return (
    <section className="start" aria-label="Start">
      <header className="start__hero">
        <h1 className="start__title">SAMPO Studio</h1>
      </header>
      <ul className="start__actions">
        {actions.map((action, index) => (
          <li key={action.label} style={{ animationDelay: `${120 + index * 60}ms` }}>
            <button
              type="button"
              className={`start__action ${index === 0 ? "start__action--primary" : ""}`}
              onClick={() => void action.run()}
            >
              <span className="start__action-text">
                <span className="start__action-label">{action.label}</span>
                <span className="start__action-hint">{action.hint}</span>
              </span>
              <Kbd keys={action.keys} />
            </button>
          </li>
        ))}
      </ul>

      {recent.length > 0 && (
        <>
          <p className="start__eyebrow start__eyebrow--secondary">Recent</p>
          <ul className="start__recent">
            {recent.map((path) => {
              const { name, folder } = splitPath(path);
              return (
                <li key={path}>
                  <button
                    type="button"
                    className="start__file"
                    title={path}
                    onClick={() => void openStoryAt(deps, path)}
                  >
                    <span className="start__file-name">{name}</span>
                    <span className="start__file-folder">{folder}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <SharedProjects />
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
