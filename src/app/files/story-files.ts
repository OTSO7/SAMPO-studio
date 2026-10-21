import { deserializeStory, FILE_EXTENSION, serializeStory } from "@core/file";
import type { Story } from "@core/model";
import type { FileHost } from "./file-host";

export type OpenResult =
  | { readonly status: "cancelled" }
  | { readonly status: "opened"; readonly path: string; readonly story: Story }
  | { readonly status: "invalid"; readonly path: string; readonly errors: readonly string[] };

export type SaveResult =
  { readonly status: "cancelled" } | { readonly status: "saved"; readonly path: string };

/**
 * Opening and saving stories on top of a `FileHost`.
 *
 * Expected outcomes (the user cancels, the file is not a valid story) are returned as
 * results. Platform failures such as a missing file or a full disk throw `FileError` from
 * the host.
 */
export class StoryFiles {
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
    return loaded.ok
      ? { status: "opened", path, story: loaded.story }
      : { status: "invalid", path, errors: loaded.errors };
  }

  /** Saves to `path`, or asks for one when the story has never been saved. */
  async save(story: Story, path: string | null): Promise<SaveResult> {
    return path === null ? this.saveAs(story) : this.writeTo(path, story);
  }

  async saveAs(story: Story): Promise<SaveResult> {
    const picked = await this.host.pickSavePath(suggestedFileName(story.title));
    return picked === null ? { status: "cancelled" } : this.writeTo(withExtension(picked), story);
  }

  private async writeTo(path: string, story: Story): Promise<SaveResult> {
    const contents = serializeStory(story, { savedAt: this.clock().toISOString() });
    await this.host.writeText(path, contents);
    return { status: "saved", path };
  }
}

const INVALID_FILE_NAME_CHARACTERS = /[<>:"/\\|?*]/gu;

/** "Routa: demo slice" -> "Routa - demo slice.sampo", safe on every platform. */
export function suggestedFileName(title: string): string {
  const base = title
    .replace(INVALID_FILE_NAME_CHARACTERS, " - ")
    .replace(/\s+/gu, " ")
    .replace(/^[\s.-]+|[\s.-]+$/gu, "");
  return `${base || "Nimetön tarina"}.${FILE_EXTENSION}`;
}

/** Save dialogs do not always append the extension the filter asked for. */
function withExtension(path: string): string {
  const suffix = `.${FILE_EXTENSION}`;
  return path.toLowerCase().endsWith(suffix) ? path : `${path}${suffix}`;
}
