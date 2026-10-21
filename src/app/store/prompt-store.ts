import type { Confirm, SaveChoice } from "../commands";
import { createStore, type Store } from "./create-store";

export interface PromptAction<T> {
  readonly label: string;
  readonly value: T;
  readonly tone?: "primary" | "danger";
}

export interface Prompt {
  readonly title: string;
  readonly message: string;
  readonly actions: readonly PromptAction<string>[];
  /** Returned when the prompt is dismissed with Escape or by clicking outside. */
  readonly cancelValue: string;
  readonly resolve: (value: string) => void;
}

export interface PromptState {
  readonly prompt: Prompt | null;
}

export type PromptStore = Store<PromptState>;

export function createPromptStore(): PromptStore {
  return createStore<PromptState>({ prompt: null });
}

/** Shows a question in the app and resolves with the chosen action's value. */
export function ask<T extends string>(
  store: PromptStore,
  question: {
    title: string;
    message: string;
    actions: readonly PromptAction<T>[];
    cancelValue: T;
  },
): Promise<T> {
  return new Promise<T>((resolve) => {
    // A new question replaces an unanswered one, which counts as cancelled.
    store.getState().prompt?.resolve(store.getState().prompt?.cancelValue ?? "");
    store.setState({
      prompt: {
        ...question,
        resolve: (value) => {
          store.setState({ prompt: null });
          resolve(value as T);
        },
      },
    });
  });
}

/** Unsaved-change questions, asked with the app's own dialog. */
export function createPromptConfirm(store: PromptStore): Confirm {
  return {
    discardChanges: async () =>
      (await ask(store, {
        title: "Unsaved changes",
        message: "This story has not been saved. Discard it?",
        actions: [
          { label: "Cancel", value: "cancel" },
          { label: "Discard", value: "discard", tone: "danger" },
        ],
        cancelValue: "cancel",
      })) === "discard",

    saveChanges: (name) =>
      ask<SaveChoice>(store, {
        title: "Save changes?",
        message: `“${name}” has changes that have not been saved.`,
        actions: [
          { label: "Don't save", value: "discard", tone: "danger" },
          { label: "Cancel", value: "cancel" },
          { label: "Save", value: "save", tone: "primary" },
        ],
        cancelValue: "cancel",
      }),
  };
}
