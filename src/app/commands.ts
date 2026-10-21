import { collectVoiceLines, storyToMarkdown, voiceLinesToCsv } from "@core/export";
import { assembleStory, suggestRows } from "@core/import";
import { createStory, type IdFactory } from "@core/model";
import { FileError, type StoryFiles } from "./files";
import {
  closeDocument,
  isDirty,
  loadDocument,
  saveDocument,
  showNotice,
  type DocumentStore,
  type NoticeStore,
} from "./store";

export type SaveChoice = "save" | "discard" | "cancel";

export interface Confirm {
  /** Asks whether unsaved changes may be thrown away. */
  discardChanges(): Promise<boolean>;
  /** Asks what to do with unsaved changes before closing `name`. */
  saveChanges(name: string): Promise<SaveChoice>;
}

export interface AppDeps {
  readonly document: DocumentStore;
  readonly notices: NoticeStore;
  readonly files: StoryFiles;
  readonly confirm: Confirm;
  readonly ids?: IdFactory;
}

/**
 * User-level actions, shared by keyboard shortcuts, menus and buttons.
 * Each resolves to `true` when the action went through.
 */

export async function newStory(deps: AppDeps): Promise<boolean> {
  if (!(await releaseCurrent(deps))) return false;
  loadDocument(deps.document, createStory(undefined, deps.ids), null);
  return true;
}

/**
 * Closes the story and returns to the start screen. Unsaved changes prompt for
 * Save / Don't save / Cancel; a story with nothing to save closes straight away.
 */
export async function closeStory(deps: AppDeps): Promise<boolean> {
  const state = deps.document.getState();
  if (state.story === null) return true;

  if (isDirty(state)) {
    const choice = await deps.confirm.saveChanges(
      state.path === null ? state.story.title : fileName(state.path),
    );
    if (choice === "cancel") return false;
    if (choice === "save" && !(await save(deps))) return false;
  }

  closeDocument(deps.document);
  return true;
}

export async function openStory(deps: AppDeps): Promise<boolean> {
  if (!(await releaseCurrent(deps))) return false;
  return applyOpen(deps, () => deps.files.open());
}

/** Opens the file the app was launched with, if it was started by opening a `.sampo`. */
export async function openLaunchFile(deps: AppDeps): Promise<boolean> {
  const path = await deps.files.launchPath();
  if (path === null || deps.document.getState().story !== null) return false;
  return applyOpen(deps, () => deps.files.openPath(path));
}

export type ExportKind = "voice-lines" | "script";

/** Writes a file for the team: a recording sheet of every line, or the story as a script. */
export async function exportStory(deps: AppDeps, kind: ExportKind): Promise<boolean> {
  const { story } = deps.document.getState();
  if (story === null) return false;

  let contents: string;
  let summary: string;
  if (kind === "voice-lines") {
    const lines = collectVoiceLines(story);
    if (lines.length === 0) {
      showNotice(deps.notices, { tone: "info", title: "This story has no dialogue to export yet" });
      return false;
    }
    contents = voiceLinesToCsv(lines);
    summary = `${lines.length} ${lines.length === 1 ? "line" : "lines"}`;
  } else {
    contents = storyToMarkdown(story);
    summary = "Script";
  }

  try {
    const result = await deps.files.export(
      contents,
      `${story.title} - ${kind === "voice-lines" ? "voice lines" : "script"}`,
      kind === "voice-lines" ? "csv" : "md",
    );
    if (result.status === "cancelled") return false;
    showNotice(deps.notices, {
      tone: "info",
      title: `${summary} exported to ${fileName(result.path)}`,
    });
    return true;
  } catch (error) {
    showNotice(deps.notices, { tone: "error", title: describeFileError(error) });
    return false;
  }
}

async function applyOpen(
  deps: AppDeps,
  open: () => ReturnType<StoryFiles["open"]>,
): Promise<boolean> {
  try {
    const result = await open();
    switch (result.status) {
      case "cancelled":
        return false;
      case "invalid":
        showNotice(deps.notices, {
          tone: "error",
          title: `Could not open ${fileName(result.path)}`,
          details: result.errors,
        });
        return false;
      case "opened":
        loadDocument(deps.document, result.story, result.path);
        return true;
    }
  } catch (error) {
    showNotice(deps.notices, { tone: "error", title: describeFileError(error) });
    return false;
  }
}

/**
 * Turns pasted text into a new, unsaved story with a drafted structure that the author
 * corrects on the board. Resolves to `false` when there was nothing to import.
 */
export async function importScript(deps: AppDeps, text: string): Promise<boolean> {
  const rows = suggestRows(text);
  if (rows.length === 0) return false;
  if (!(await releaseCurrent(deps))) return false;

  loadDocument(deps.document, assembleStory(rows, deps.ids), null);
  return true;
}

export async function save(deps: AppDeps, options: { saveAs?: boolean } = {}): Promise<boolean> {
  const outcome = await saveDocument(deps.document, deps.files, options);
  if (outcome === "failed") {
    const status = deps.document.getState().saveStatus;
    showNotice(deps.notices, {
      tone: "error",
      title: "Save failed",
      ...(status.kind === "failed" ? { details: [status.message] } : {}),
    });
  }
  return outcome === "saved";
}

/**
 * Makes sure replacing the open story loses nothing. Stories with a file are saved first;
 * stories that were never saved need the user's permission to be discarded.
 */
async function releaseCurrent(deps: AppDeps): Promise<boolean> {
  const state = deps.document.getState();
  if (state.story === null || !isDirty(state)) return true;
  if (state.path !== null) return save(deps);
  return deps.confirm.discardChanges();
}

function fileName(path: string): string {
  return path.split(/[\\/]/u).pop() ?? path;
}

function describeFileError(error: unknown): string {
  if (!(error instanceof FileError)) return "Something went wrong while opening the file";
  switch (error.code) {
    case "not_found":
      return "File not found";
    case "not_a_story_file":
      return "Not a SAMPO story file";
    case "unsupported_export":
      return "That file type cannot be exported to";
    case "too_large":
      return "File is too large to open";
    case "io":
    case "unknown":
      return error.message;
  }
}
