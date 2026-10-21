import { StoryFiles, tauriFileHost } from "@app/files";
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
    },
    prompts,
    autosave: startAutosave(document, files),
  };
}
