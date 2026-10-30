import { invoke, isTauri } from "@tauri-apps/api/core";

import type { AppDeps } from "./commands";
import { sharedProjectMedia } from "./live/project";
import { storyMediaIds } from "@core/model";

const LAST_RUN_KEY = "sampo.mediaCleaned";
const DAY_MS = 24 * 60 * 60 * 1000;
/** Well after starting up, so it never competes with opening a story. */
const DELAY_MS = 60_000;

/**
 * Tidies the media folder at most once a day, in the background (see `clean_media` in
 * storage.rs). Failing costs nothing but some disk space until the next time.
 */
export function scheduleMediaCleanup(deps: AppDeps): () => void {
  if (!isTauri()) return () => undefined;
  const timer = window.setTimeout(() => {
    void cleanOnce(deps).catch((error: unknown) => {
      console.warn("Media cleanup skipped", error);
    });
  }, DELAY_MS);
  return () => {
    window.clearTimeout(timer);
  };
}

async function cleanOnce(deps: AppDeps): Promise<void> {
  const last = Number(window.localStorage.getItem(LAST_RUN_KEY) ?? 0);
  if (Date.now() - last < DAY_MS) return;
  const { story } = deps.document.getState();
  await invoke("clean_media_folder", {
    keep: [...(await sharedProjectMedia()), ...(story === null ? [] : storyMediaIds(story))],
    packages: deps.recent?.list() ?? [],
  });
  window.localStorage.setItem(LAST_RUN_KEY, String(Date.now()));
}
