/**
 * Everything the app needs from the platform to open and save files.
 *
 * The desktop build implements this with Tauri; tests use an in-memory fake, and a future
 * read-only web viewer can provide its own without touching the code that uses it.
 */
export interface FileHost {
  /** Resolves to `null` when the user cancels. */
  pickOpenPath(): Promise<string | null>;
  /** Resolves to `null` when the user cancels. */
  pickSavePath(suggestedName: string): Promise<string | null>;
  readText(path: string): Promise<string>;
  writeText(path: string, contents: string): Promise<void>;
  /** When the story file was last written, in ms; `null` when it does not exist. */
  modifiedAt(path: string): Promise<number | null>;
  /** Resolves to `null` when the user cancels. */
  pickExportPath(suggestedName: string, format: ExportFormat): Promise<string | null>;
  writeExport(path: string, contents: string): Promise<void>;
  /** The story the app was started with, e.g. by double-clicking a file. */
  launchPath(): Promise<string | null>;
}

export type ExportFormat = "csv" | "md";

export type FileErrorCode =
  | "not_found"
  | "not_a_story_file"
  | "unsupported_export"
  | "too_large"
  | "io"
  | "changed_on_disk"
  | "unknown";

/** A platform failure with a stable code the UI can turn into a friendly message. */
export class FileError extends Error {
  override readonly name = "FileError";

  constructor(
    readonly code: FileErrorCode,
    message: string,
  ) {
    super(message);
  }
}
