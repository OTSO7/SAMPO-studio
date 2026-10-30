import { useEffect } from "react";

import { importScript, newStory, openStory, save, type AppDeps } from "@app/commands";
import { liveUndo } from "@app/live/project";
import { redo, undo } from "@app/store";

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement)
  );
}

/**
 * Global document shortcuts. Text fields keep their own undo and paste; everywhere else,
 * Ctrl+Z undoes story edits and pasting drafts a new story from the text.
 */
export function useShortcuts(deps: AppDeps): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();

      if ((key === "z" || key === "y") && !isEditable(event.target)) {
        event.preventDefault();
        const again = key === "y" || event.shiftKey;
        // In a live session only this person's own edits are undone, never a friend's.
        if (liveUndo(again)) return;
        if (again) redo(deps.document);
        else undo(deps.document);
        return;
      }

      const run = {
        n: () => newStory(deps),
        o: () => openStory(deps),
        s: () => save(deps, { saveAs: event.shiftKey }),
      }[key];

      if (run === undefined) return;
      event.preventDefault();
      void run();
    };

    const onPaste = (event: ClipboardEvent) => {
      if (isEditable(event.target)) return;

      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (text.trim() === "") return;

      event.preventDefault();
      void importScript(deps, text, event.clipboardData?.getData("text/html"));
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("paste", onPaste);
    };
  }, [deps]);
}
