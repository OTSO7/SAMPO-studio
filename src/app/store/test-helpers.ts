import { FileError, StoryFiles, type FileHost } from "../files";
import type { Timers } from "./autosave";

/**
 * File host whose writes can be held open, so tests can make edits while a save is in
 * flight and then decide when it completes.
 */
export class ControlledHost implements FileHost {
  readonly writes: { path: string; contents: string }[] = [];
  saveAnswer: string | null = null;
  holdWrites = false;
  failWith: FileError | null = null;
  private readonly held: (() => void)[] = [];

  pickOpenPath() {
    return Promise.resolve(null);
  }

  pickSavePath() {
    return Promise.resolve(this.saveAnswer);
  }

  readText(): Promise<string> {
    return Promise.reject(new FileError("not_found", "not used"));
  }

  writeText(path: string, contents: string) {
    if (this.failWith !== null) return Promise.reject(this.failWith);
    this.writes.push({ path, contents });
    if (!this.holdWrites) return Promise.resolve();
    return new Promise<void>((resolve) => this.held.push(resolve));
  }

  releaseWrites() {
    this.held.splice(0).forEach((resolve) => {
      resolve();
    });
  }
}

/** Timers that only fire when the test says so. */
export class ManualTimers implements Timers {
  private nextHandle = 1;
  private readonly pending = new Map<number, { callback: () => void; ms: number }>();

  setTimeout(callback: () => void, ms: number) {
    const handle = this.nextHandle++;
    this.pending.set(handle, { callback, ms });
    return handle;
  }

  clearTimeout(handle: unknown) {
    this.pending.delete(handle as number);
  }

  get scheduled(): number[] {
    return [...this.pending.values()].map((timer) => timer.ms);
  }

  fireAll() {
    const due = [...this.pending.values()];
    this.pending.clear();
    due.forEach((timer) => {
      timer.callback();
    });
  }
}

export function storyFilesFor(host: FileHost) {
  return new StoryFiles(host, () => new Date("2026-10-21T10:00:00.000Z"));
}

/** Lets pending promise callbacks run. */
export const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
