import { useCallback, useEffect, useState } from "react";

import { watchBackups } from "@app/backups";
import { confirmWindowClose, openLaunchFile } from "@app/commands";
import { watchProjects } from "@app/live/project";
import { guardWindowClose, toggleFullscreen } from "@app/window";

import { Board } from "@ui/board/Board";
import { FocusView } from "@ui/focus/FocusView";
import { useStore } from "@ui/hooks/use-store";
import { useServices } from "@ui/services/use-services";
import { NoticeBar } from "./NoticeBar";
import { PromptDialog } from "./PromptDialog";
import { ShortcutsSheet } from "./ShortcutsSheet";
import { StartScreen } from "./StartScreen";
import { Statusbar } from "./Statusbar";
import { Titlebar } from "./Titlebar";
import { useSaveConflict } from "./use-save-conflict";
import { useShortcuts } from "./use-shortcuts";
import { useUpdateCheck } from "./use-update-check";
import { isNewVersion, markVersionSeen } from "./changelog";
import { WhatsNew } from "./WhatsNew";

import "./app-shell.css";

export function AppShell() {
  const { deps, prompts } = useServices();
  const story = useStore(deps.document, (state) => state.story);
  const [focusing, setFocusing] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  // The first start after an update opens on what changed.
  const [showWhatsNew, setShowWhatsNew] = useState(isNewVersion);
  useShortcuts(deps);
  useSaveConflict(deps);
  useUpdateCheck(prompts, deps.notices);

  // Shared stories open as their project; every story gets its version history.
  useEffect(() => watchProjects(deps), [deps]);
  useEffect(() => watchBackups(deps.document), [deps]);

  // F11 toggles full screen, like a browser or a media player.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F11") {
        event.preventDefault();
        void toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  // A file dropped anywhere but a card would make the webview open it in place of the app.
  useEffect(() => {
    const keepApp = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files") === true) event.preventDefault();
    };
    window.addEventListener("dragover", keepApp);
    window.addEventListener("drop", keepApp);
    return () => {
      window.removeEventListener("dragover", keepApp);
      window.removeEventListener("drop", keepApp);
    };
  }, []);

  // Double-clicking a .sampo file starts the app with that file.
  useEffect(() => {
    void openLaunchFile(deps);
  }, [deps]);

  // Closing the window never loses work: saved stories are saved, new ones ask first.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void guardWindowClose(() => confirmWindowClose(deps)).then((remove) => {
      if (disposed) remove();
      else unlisten = remove;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [deps]);

  const closeShortcuts = useCallback(() => {
    setShowShortcuts(false);
  }, []);
  const closeWhatsNew = useCallback(() => {
    markVersionSeen();
    setShowWhatsNew(false);
  }, []);

  // ? or F1 lists every shortcut.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement);
      if (event.key === "F1" || (event.key === "?" && !typing)) {
        event.preventDefault();
        setShowShortcuts(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const exitFocus = useCallback(() => {
    setFocusing(false);
  }, []);

  // F5 starts presenting, as in every slide tool.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F5" && story !== null) {
        event.preventDefault();
        setFocusing((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [story]);

  if (focusing && story !== null) {
    return (
      <>
        <FocusView story={story} onExit={exitFocus} />
        <NoticeBar />
        <PromptDialog />
        {showShortcuts && <ShortcutsSheet onClose={closeShortcuts} />}
      </>
    );
  }

  return (
    <div className="shell">
      <Titlebar
        onFocus={
          story === null
            ? null
            : () => {
                setFocusing(true);
              }
        }
      />
      <main className={`shell__main ${story === null ? "" : "shell__main--board"}`}>
        {/* Keyed by story: opening another story starts its board fresh, on the Board view. */}
        {story === null ? <StartScreen /> : <Board key={story.id} story={story} />}
      </main>
      <Statusbar
        onShowShortcuts={() => {
          setShowShortcuts(true);
        }}
        onShowWhatsNew={() => {
          setShowWhatsNew(true);
        }}
      />
      <NoticeBar />
      <PromptDialog />
      {showShortcuts && <ShortcutsSheet onClose={closeShortcuts} />}
      {showWhatsNew && <WhatsNew onClose={closeWhatsNew} />}
    </div>
  );
}
