import { useCallback, useEffect, useState } from "react";

import { Board } from "@ui/board/Board";
import { FocusView } from "@ui/focus/FocusView";
import { useStore } from "@ui/hooks/use-store";
import { useServices } from "@ui/services/use-services";
import { NoticeBar } from "./NoticeBar";
import { PromptDialog } from "./PromptDialog";
import { StartScreen } from "./StartScreen";
import { Statusbar } from "./Statusbar";
import { Titlebar } from "./Titlebar";
import { useShortcuts } from "./use-shortcuts";

import "./app-shell.css";

export function AppShell() {
  const { deps } = useServices();
  const story = useStore(deps.document, (state) => state.story);
  const [focusing, setFocusing] = useState(false);
  useShortcuts(deps);

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
      <Statusbar />
      <NoticeBar />
      <PromptDialog />
    </div>
  );
}
