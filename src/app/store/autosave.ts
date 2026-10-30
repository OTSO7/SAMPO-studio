import type { StoryFiles } from "../files";
import { isDirty, type DocumentStore } from "./document-store";
import { saveDocument } from "./save-document";

export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AutosaveOptions {
  readonly delayMs?: number;
  readonly timers?: Timers;
}

export interface Autosave {
  /** Saves pending changes right away, e.g. before the window closes. */
  flush(): Promise<void>;
  stop(): void;
}

const DEFAULT_DELAY_MS = 2000;

const browserTimers: Timers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  },
};

/**
 * Saves the document a short while after the last edit.
 *
 * Only documents that already have a file are autosaved; a brand new story is never
 * interrupted by a save dialog. Saves never overlap: edits made during a save schedule
 * another one once it finishes.
 */
export function startAutosave(
  store: DocumentStore,
  files: StoryFiles,
  options: AutosaveOptions = {},
): Autosave {
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const timers = options.timers ?? browserTimers;

  let timer: unknown = null;
  let inFlight: Promise<void> | null = null;

  const shouldSave = () => {
    const state = store.getState();
    return state.path !== null && isDirty(state) && state.saveStatus.kind !== "conflict";
  };

  const cancelTimer = () => {
    if (timer !== null) {
      timers.clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = () => {
    cancelTimer();
    if (shouldSave()) timer = timers.setTimeout(tick, delayMs);
  };

  const tick = () => {
    void run();
  };

  const run = (): Promise<void> => {
    cancelTimer();
    if (inFlight !== null) return inFlight;
    if (!shouldSave()) return Promise.resolve();

    inFlight = saveDocument(store, files).then(() => {
      inFlight = null;
      // Edits made during the save are still dirty; pick them up after the usual delay.
      schedule();
    });
    return inFlight;
  };

  const unsubscribe = store.subscribe((state, previous) => {
    if (state.revision !== previous.revision) schedule();
  });

  return {
    async flush() {
      await inFlight;
      await run();
    },
    stop() {
      cancelTimer();
      unsubscribe();
    },
  };
}
