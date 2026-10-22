import { FileError, type StoryFiles } from "../files";
import {
  isDirty,
  markSaveCancelled,
  markSaveConflict,
  markSaved,
  markSaveFailed,
  markSaving,
  type DocumentStore,
} from "./document-store";

export interface SaveDocumentOptions {
  /** Always ask where to save, even if the document already has a path. */
  readonly saveAs?: boolean;
  /** Replace the file even if another program saved it since it was opened. */
  readonly overwrite?: boolean;
  readonly now?: () => Date;
}

export type SaveOutcome = "saved" | "cancelled" | "failed" | "conflict" | "nothing-to-save";

/** The save each document is busy with, so the next one waits for it. */
const inProgress = new WeakMap<DocumentStore, Promise<SaveOutcome>>();

/**
 * Saves the open document and records the outcome in the store. Never throws.
 *
 * Saves run one at a time: Ctrl+S during an autosave waits for it instead of writing the
 * same file at the same moment, which Windows refuses. A save that finds everything already
 * saved by the one before it has nothing left to do.
 */
export function saveDocument(
  store: DocumentStore,
  files: StoryFiles,
  options: SaveDocumentOptions = {},
): Promise<SaveOutcome> {
  const previous = inProgress.get(store);
  const next = (previous ?? Promise.resolve<SaveOutcome>("nothing-to-save")).then(() => {
    const { path, story } = store.getState();
    const alreadySaved = previous !== undefined && !options.saveAs && path !== null;
    if (alreadySaved && story !== null && !isDirty(store.getState())) return "saved" as const;
    return saveNow(store, files, options);
  });
  inProgress.set(store, next);
  void next.finally(() => {
    if (inProgress.get(store) === next) inProgress.delete(store);
  });
  return next;
}

async function saveNow(
  store: DocumentStore,
  files: StoryFiles,
  options: SaveDocumentOptions,
): Promise<SaveOutcome> {
  const { story, path, revision } = store.getState();
  if (story === null) return "nothing-to-save";

  markSaving(store);
  try {
    const result = options.saveAs
      ? await files.saveAs(story)
      : await files.save(story, path, options.overwrite);

    if (result.status === "cancelled") {
      markSaveCancelled(store);
      return "cancelled";
    }

    markSaved(store, result.path, revision, (options.now ?? (() => new Date()))());
    return "saved";
  } catch (error) {
    if (error instanceof FileError && error.code === "changed_on_disk") {
      markSaveConflict(store);
      return "conflict";
    }
    markSaveFailed(store, error instanceof Error ? error.message : String(error));
    return "failed";
  }
}
