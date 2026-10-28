import type { Story } from "@core/model";
import { createStore, type Store } from "./create-store";

export type SaveStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "saving" }
  | { readonly kind: "saved"; readonly at: Date }
  | { readonly kind: "failed"; readonly message: string }
  /** Another program saved the file; autosave waits until the user decides. */
  | { readonly kind: "conflict" };

export interface DocumentState {
  readonly story: Story | null;
  /** Where the story lives on disk; `null` until it has been saved once. */
  readonly path: string | null;
  /** Incremented on every edit. Saves record which revision they wrote. */
  readonly revision: number;
  readonly savedRevision: number;
  readonly saveStatus: SaveStatus;
  /** Earlier versions of the story, most recent last. */
  readonly past: readonly Story[];
  readonly future: readonly Story[];
  /** Edits sharing a group (typing in one field) collapse into a single undo step. */
  readonly editGroup: string | null;
}

export type DocumentStore = Store<DocumentState>;

export const EMPTY_DOCUMENT: DocumentState = {
  story: null,
  path: null,
  revision: 0,
  savedRevision: 0,
  saveStatus: { kind: "idle" },
  past: [],
  future: [],
  editGroup: null,
};

const HISTORY_LIMIT = 100;

export function createDocumentStore(initial: DocumentState = EMPTY_DOCUMENT): DocumentStore {
  return createStore(initial);
}

export const isDirty = (state: DocumentState): boolean => state.revision !== state.savedRevision;

/** Closes the story and returns to the start screen. Callers make sure nothing is lost. */
export function closeDocument(store: DocumentStore): void {
  const revision = store.getState().revision + 1;
  store.setState({ ...EMPTY_DOCUMENT, revision, savedRevision: revision });
}

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
    past: [],
    future: [],
    editGroup: null,
  });
}

export interface EditOptions {
  /** Consecutive edits with the same group undo together, e.g. `text:<blockId>`. */
  readonly group?: string;
}

export function editStory(
  store: DocumentStore,
  recipe: (story: Story) => Story,
  options: EditOptions = {},
): void {
  store.setState((state) => {
    if (state.story === null) return {};
    const story = recipe(state.story);
    if (story === state.story) return {};

    const group = options.group ?? null;
    const continues = group !== null && group === state.editGroup;
    return {
      story,
      revision: state.revision + 1,
      past: continues ? state.past : [...state.past, state.story].slice(-HISTORY_LIMIT),
      future: [],
      editGroup: group,
    };
  });
}

export const canUndo = (state: DocumentState): boolean => state.past.length > 0;
export const canRedo = (state: DocumentState): boolean => state.future.length > 0;

export function undo(store: DocumentStore): void {
  store.setState((state) => {
    const previous = state.past.at(-1);
    if (previous === undefined || state.story === null) return {};
    return {
      story: previous,
      past: state.past.slice(0, -1),
      future: [state.story, ...state.future],
      revision: state.revision + 1,
      editGroup: null,
    };
  });
}

export function redo(store: DocumentStore): void {
  store.setState((state) => {
    const [next, ...rest] = state.future;
    if (next === undefined || state.story === null) return {};
    return {
      story: next,
      past: [...state.past, state.story],
      future: rest,
      revision: state.revision + 1,
      editGroup: null,
    };
  });
}

/**
 * Takes a version of the story made elsewhere, e.g. by a friend in a live session. It counts
 * as an edit, so it gets saved, but not as one of this person's: undo history starts over.
 */
export function replaceStory(store: DocumentStore, story: Story): void {
  store.setState((state) => ({
    story,
    revision: state.revision + 1,
    past: [],
    future: [],
    editGroup: null,
  }));
}

/**
 * Records that `revision` is kept safe without a file, e.g. in a shared project's copy on
 * this computer, so closing the story asks nothing.
 */
export function markKept(store: DocumentStore, revision: number, at: Date): void {
  store.setState((state) => ({
    savedRevision: Math.max(state.savedRevision, revision),
    saveStatus: { kind: "saved", at },
  }));
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

export function markSaveConflict(store: DocumentStore): void {
  store.setState({ saveStatus: { kind: "conflict" } });
}

export function markSaveCancelled(store: DocumentStore): void {
  store.setState({ saveStatus: { kind: "idle" } });
}
