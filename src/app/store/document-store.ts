import type { Story } from "@core/model";
import { createStore, type Store } from "./create-store";

export type SaveStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "saving" }
  | { readonly kind: "saved"; readonly at: Date }
  | { readonly kind: "failed"; readonly message: string };

export interface DocumentState {
  readonly story: Story | null;
  /** Where the story lives on disk; `null` until it has been saved once. */
  readonly path: string | null;
  /** Incremented on every edit. Saves record which revision they wrote. */
  readonly revision: number;
  readonly savedRevision: number;
  readonly saveStatus: SaveStatus;
}

export type DocumentStore = Store<DocumentState>;

export const EMPTY_DOCUMENT: DocumentState = {
  story: null,
  path: null,
  revision: 0,
  savedRevision: 0,
  saveStatus: { kind: "idle" },
};

export function createDocumentStore(initial: DocumentState = EMPTY_DOCUMENT): DocumentStore {
  return createStore(initial);
}

export const isDirty = (state: DocumentState): boolean => state.revision !== state.savedRevision;

/** Replaces the open document, e.g. after opening a file or importing pasted text. */
export function loadDocument(store: DocumentStore, story: Story, path: string | null): void {
  const revision = store.getState().revision + 1;
  store.setState({
    story,
    path,
    revision,
    // An imported story has never been written anywhere, so it starts out unsaved.
    savedRevision: path === null ? revision - 1 : revision,
    saveStatus: { kind: "idle" },
  });
}

export function editStory(store: DocumentStore, recipe: (story: Story) => Story): void {
  store.setState((state) =>
    state.story === null ? {} : { story: recipe(state.story), revision: state.revision + 1 },
  );
}

export function markSaving(store: DocumentStore): void {
  store.setState({ saveStatus: { kind: "saving" } });
}

/**
 * Records a finished save of `revision`. Edits made while the save was in flight have a
 * higher revision, so the document correctly stays dirty.
 */
export function markSaved(store: DocumentStore, path: string, revision: number, at: Date): void {
  store.setState((state) => ({
    path,
    savedRevision: Math.max(state.savedRevision, revision),
    saveStatus: { kind: "saved", at },
  }));
}

export function markSaveFailed(store: DocumentStore, message: string): void {
  store.setState({ saveStatus: { kind: "failed", message } });
}

export function markSaveCancelled(store: DocumentStore): void {
  store.setState({ saveStatus: { kind: "idle" } });
}
