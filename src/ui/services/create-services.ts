import { StoryFiles, tauriFileHost } from "@app/files";
import { createRecentFiles } from "@app/recent-files";
import {
  createDocumentStore,
  createNoticeStore,
  createPromptConfirm,
  createPromptStore,
  startAutosave,
} from "@app/store";
import type { Services } from "./services";

/** Wires the desktop app together. Tests build their own services with fakes instead. */
export function createServices(): Services {
  const document = createDocumentStore();
  const prompts = createPromptStore();
  const files = new StoryFiles(tauriFileHost);

  return {
    deps: {
      document,
      notices: createNoticeStore(),
      files,
      confirm: createPromptConfirm(prompts),
      recent: createRecentFiles(browserStorage()),
    },
    prompts,
    autosave: startAutosave(document, files),
  };
}

/** Local storage can be missing or blocked; recent files then simply are not remembered. */
function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
