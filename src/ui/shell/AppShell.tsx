import { useCallback, useEffect, useState } from "react";

import { watchBackups } from "@app/backups";
import { confirmWindowClose, openLaunchFile } from "@app/commands";
import { live, watchProjects } from "@app/live/project";
import { scheduleMediaCleanup } from "@app/media-cleanup";
import { followStoryVolume } from "@app/sfx";
import { isPlaying } from "@app/playback";
import { ask } from "@app/store";
import { guardWindowClose, toggleFullscreen } from "@app/window";

import { Board } from "@ui/board/Board";
import { FocusView } from "@ui/focus/FocusView";
import { SyncingScreen } from "@ui/live/SyncingScreen";
import { useStore } from "@ui/hooks/use-store";
import { useServices } from "@ui/services/use-services";
import { ErrorBoundary } from "./ErrorBoundary";
import { NoticeBar } from "./NoticeBar";
import { NowPlaying } from "./NowPlaying";
import { OpeningScreen } from "./OpeningScreen";
import { PromptDialog } from "./PromptDialog";
import { SettingsSheet } from "./SettingsSheet";
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
  const sharedOpen = useStore(live, (s) => s.state.kind === "open");
  // A shared project cannot be edited until it is in sync; see SyncingScreen.
  const syncing = useStore(live, (s) => s.state.kind === "open" && s.state.gate !== null);
  const [focusing, setFocusing] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // The first start after an update opens on what changed.
  const [showWhatsNew, setShowWhatsNew] = useState(isNewVersion);
  useShortcuts(deps);
  useSaveConflict(deps);
  useUpdateCheck(prompts, deps.notices);

  // Shared stories open as their project; every story gets its version history.
  useEffect(() => watchProjects(deps), [deps]);
  useEffect(() => watchBackups(deps.document), [deps]);
  useEffect(() => scheduleMediaCleanup(deps), [deps]);
  useEffect(() => followStoryVolume(deps.document), [deps]);

  // Windows puts a window into menu mode when Alt is pressed alone; the next inputs then go
  // to a menu bar this app does not have, which made Alt + wheel zoom stop until a click.
  useEffect(() => {
    const keepFocus = (event: KeyboardEvent) => {
      if (event.key === "Alt") event.preventDefault();
    };
    window.addEventListener("keydown", keepFocus);
    window.addEventListener("keyup", keepFocus);
    return () => {
      window.removeEventListener("keydown", keepFocus);
      window.removeEventListener("keyup", keepFocus);
    };
  }, []);

  // The webview's own reload, back and print would stop the music and leave the app: in a
  // desktop app those keys, the mouse's back button and the page's own right-click menu do
  // nothing. Text fields keep their menu for copy and paste.
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const ctrl = event.ctrlKey || event.metaKey;
      if (
        key === "f5" ||
        key.startsWith("browser") ||
        (ctrl && (key === "r" || key === "p")) ||
        (event.altKey &&
          (key === "arrowleft" || key === "arrowright") &&
          !isTextField(event.target))
      ) {
        event.preventDefault();
      }
    };
    const menu = (event: MouseEvent) => {
      if (!isTextField(event.target)) event.preventDefault();
    };
    const back = (event: MouseEvent) => {
      if (event.button === 3 || event.button === 4) event.preventDefault();
    };
    window.addEventListener("keydown", keys);
    window.addEventListener("contextmenu", menu);
    window.addEventListener("mouseup", back);
    window.addEventListener("mousedown", back);
    return () => {
      window.removeEventListener("keydown", keys);
      window.removeEventListener("contextmenu", menu);
      window.removeEventListener("mouseup", back);
      window.removeEventListener("mousedown", back);
    };
  }, []);

  // After a click on a player, the arrow keys and Space go back to the running order, instead
  // of Space pausing the song through a button that happens to still have focus.
  useEffect(() => {
    const release = (event: PointerEvent) => {
      const control = (event.target as Element).closest(".player, .deck");
      if (control !== null && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    };
    window.addEventListener("pointerup", release);
    return () => {
      window.removeEventListener("pointerup", release);
    };
  }, []);

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
    const stopMusicFirst = async () =>
      !isPlaying() ||
      (await ask(prompts, {
        title: "Music is playing",
        message: "Closing SAMPO Studio stops the sound that is playing.",
        actions: [
          { label: "Keep playing", value: "keep" },
          { label: "Close", value: "close", tone: "danger" },
        ],
        cancelValue: "keep",
      })) === "close";
    void guardWindowClose(async () => (await stopMusicFirst()) && confirmWindowClose(deps)).then(
      (remove) => {
        if (disposed) remove();
        else unlisten = remove;
      },
    );
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [deps, prompts]);

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
      if (event.key === "F5" && story !== null && !syncing) {
        event.preventDefault();
        setFocusing((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [story, syncing]);

  if (focusing && story !== null && !syncing) {
    return (
      <>
        <ErrorBoundary>
          <FocusView story={story} onExit={exitFocus} />
        </ErrorBoundary>
        <NowPlaying placement="left" />
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
          story === null || syncing
            ? null
            : () => {
                setFocusing(true);
              }
        }
        onShowSettings={() => {
          setShowSettings(true);
        }}
        onShowShortcuts={() => {
          setShowShortcuts(true);
        }}
        onShowWhatsNew={() => {
          setShowWhatsNew(true);
        }}
      />
      <main className={`shell__main ${story === null ? "" : "shell__main--board"}`}>
        {/* Keyed by story: opening another story starts its board fresh, on the Board view. */}
        {story !== null && !syncing ? (
          <ErrorBoundary key={story.id}>
            <Board story={story} />
          </ErrorBoundary>
        ) : sharedOpen ? (
          <SyncingScreen />
        ) : (
          <StartScreen />
        )}
      </main>
      <Statusbar
        onShowShortcuts={() => {
          setShowShortcuts(true);
        }}
        onShowWhatsNew={() => {
          setShowWhatsNew(true);
        }}
      />
      <NowPlaying />
      <OpeningScreen />
      <NoticeBar />
      <PromptDialog />
      {showShortcuts && <ShortcutsSheet onClose={closeShortcuts} />}
      {showWhatsNew && <WhatsNew onClose={closeWhatsNew} />}
      {showSettings && story !== null && (
        <SettingsSheet
          onClose={() => {
            setShowSettings(false);
          }}
        />
      )}
    </div>
  );
}

function isTextField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement)
  );
}
