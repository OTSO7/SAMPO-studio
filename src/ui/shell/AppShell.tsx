import { useCallback, useEffect, useState } from "react";

import { confirmWindowClose, openLaunchFile } from "@app/commands";
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

import "./app-shell.css";

export function AppShell() {
  const { deps, prompts } = useServices();
  const story = useStore(deps.document, (state) => state.story);
  const [focusing, setFocusing] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  useShortcuts(deps);
  useSaveConflict(deps);
  useUpdateCheck(prompts, deps.notices);

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
        {story === null ? <StartScreen /> : <Board story={story} />}
      </main>
      <Statusbar
        onShowShortcuts={() => {
          setShowShortcuts(true);
        }}
      />
      <NoticeBar />
      <PromptDialog />
      {showShortcuts && <ShortcutsSheet onClose={closeShortcuts} />}
    </div>
  );
}
