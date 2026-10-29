import { useEffect } from "react";

import { ask, type NoticeStore, type PromptStore, showNotice } from "@app/store";
import { isPlaying } from "@app/playback";
import { findUpdate } from "@app/updates";

/** Looks for a newer release a few seconds after start and asks before installing it. */
export function useUpdateCheck(prompts: PromptStore, notices: NoticeStore): void {
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void findUpdate().then(async (update) => {
        // Never offer a restart in the middle of a song.
        if (cancelled || update === null || isPlaying()) return;
        const choice = await ask(prompts, {
          title: "Update available",
          message: `SAMPO Studio ${update.version} is ready. Install it now? The app restarts once.`,
          actions: [
            { label: "Later", value: "later" },
            { label: "Install and restart", value: "install", tone: "primary" },
          ],
          cancelValue: "later",
        });
        if (choice !== "install") return;
        try {
          await update.install();
        } catch (error) {
          showNotice(notices, {
            tone: "error",
            title: "The update could not be installed.",
            details: [String(error)],
          });
        }
      });
    }, 3000);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [prompts, notices]);
}
