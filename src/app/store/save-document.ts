import type { StoryFiles } from "../files";
import {
  markSaveCancelled,
  markSaved,
  markSaveFailed,
  markSaving,
  type DocumentStore,
} from "./document-store";

export interface SaveDocumentOptions {
  /** Always ask where to save, even if the document already has a path. */
  readonly saveAs?: boolean;
  readonly now?: () => Date;
}

export type SaveOutcome = "saved" | "cancelled" | "failed" | "nothing-to-save";

/** Saves the open document and records the outcome in the store. Never throws. */
export async function saveDocument(
  store: DocumentStore,
  files: StoryFiles,
  options: SaveDocumentOptions = {},
): Promise<SaveOutcome> {
  const { story, path, revision } = store.getState();
  if (story === null) return "nothing-to-save";

  markSaving(store);
  try {
    const result = options.saveAs ? await files.saveAs(story) : await files.save(story, path);

    if (result.status === "cancelled") {
      markSaveCancelled(store);
      return "cancelled";
    }

    markSaved(store, result.path, revision, (options.now ?? (() => new Date()))());
    return "saved";
  } catch (error) {
    markSaveFailed(store, error instanceof Error ? error.message : String(error));
    return "failed";
  }
}
