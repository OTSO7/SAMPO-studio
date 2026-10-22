import { deserializeStory, FILE_EXTENSION, serializeStory } from "@core/file";
import type { Story } from "@core/model";
import { FileError, type ExportFormat, type FileHost } from "./file-host";

export type OpenResult =
  | { readonly status: "cancelled" }
  | { readonly status: "opened"; readonly path: string; readonly story: Story }
  | { readonly status: "invalid"; readonly path: string; readonly errors: readonly string[] };

export type SaveResult =
  { readonly status: "cancelled" } | { readonly status: "saved"; readonly path: string };

export type ExportResult =
  { readonly status: "cancelled" } | { readonly status: "exported"; readonly path: string };

/**
 * Opening and saving stories on top of a `FileHost`.
 *
 * Expected outcomes (the user cancels, the file is not a valid story) are returned as
 * results. Platform failures such as a missing file or a full disk throw `FileError` from
 * the host.
 */
export class StoryFiles {
  /** When each file was last read or written by this app, to notice saves by others. */
  private readonly known = new Map<string, number | null>();

  constructor(
    private readonly host: FileHost,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async open(): Promise<OpenResult> {
    const path = await this.host.pickOpenPath();
    return path === null ? { status: "cancelled" } : this.openPath(path);
  }

  /** Opens a known path, e.g. from the recent files list or a double-clicked file. */
  async openPath(path: string): Promise<OpenResult> {
    const loaded = deserializeStory(await this.host.readText(path));
    this.known.set(path, await this.host.modifiedAt(path));
    return loaded.ok
      ? { status: "opened", path, story: loaded.story }
      : { status: "invalid", path, errors: loaded.errors };
  }

  /**
   * Saves to `path`, or asks for one when the story has never been saved. Throws a
   * `changed_on_disk` error when another program saved the file since; `overwrite` skips that.
   */
  async save(story: Story, path: string | null, overwrite = false): Promise<SaveResult> {
    if (path === null) return this.saveAs(story);
    if (!overwrite && this.known.has(path)) {
      // shortcut: a save landing between this check and the write goes unnoticed,
      // revisit together with the .sampo.lock file for shared folders.
      const current = await this.host.modifiedAt(path);
      // A deleted file is simply written again; only someone else's save is a conflict.
      if (current !== null && current !== this.known.get(path)) {
        throw new FileError("changed_on_disk", `${path} was changed by another program`);
      }
    }
    return this.writeTo(path, story);
  }

  /** The save dialog already confirmed replacing an existing file, so no conflict check. */
  async saveAs(story: Story): Promise<SaveResult> {
    const picked = await this.host.pickSavePath(suggestedFileName(story.title));
    return picked === null ? { status: "cancelled" } : this.writeTo(withExtension(picked), story);
  }

  /** The story the app was launched with, if any. */
  launchPath(): Promise<string | null> {
    return this.host.launchPath();
  }

  /** Asks where to put an export and writes it there. */
  async export(contents: string, name: string, format: ExportFormat): Promise<ExportResult> {
    const picked = await this.host.pickExportPath(`${safeName(name)}.${format}`, format);
    if (picked === null) return { status: "cancelled" };
    const path = picked.toLowerCase().endsWith(`.${format}`) ? picked : `${picked}.${format}`;
    await this.host.writeExport(path, contents);
    return { status: "exported", path };
  }

  private async writeTo(path: string, story: Story): Promise<SaveResult> {
    const contents = serializeStory(story, { savedAt: this.clock().toISOString() });
    await this.host.writeText(path, contents);
    this.known.set(path, await this.host.modifiedAt(path));
    return { status: "saved", path };
  }
}

const INVALID_FILE_NAME_CHARACTERS = /[<>:"/\\|?*]/gu;

/** "Routa: demo slice" -> "Routa - demo slice.sampo", safe on every platform. */
export function suggestedFileName(title: string): string {
  return `${safeName(title)}.${FILE_EXTENSION}`;
}

function safeName(title: string): string {
  const base = title
    .replace(INVALID_FILE_NAME_CHARACTERS, " - ")
    .replace(/\s+/gu, " ")
    .replace(/^[\s.-]+|[\s.-]+$/gu, "");
  return base || "Untitled";
}

/** Save dialogs do not always append the extension the filter asked for. */
function withExtension(path: string): string {
  const suffix = `.${FILE_EXTENSION}`;
  return path.toLowerCase().endsWith(suffix) ? path : `${path}${suffix}`;
}
