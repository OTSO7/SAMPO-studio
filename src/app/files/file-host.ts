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
  /** Reads the story text; the package's pictures and sounds become available to `mediaUrl`. */
  readText(path: string): Promise<string>;
  /** Writes the story as one package together with the packed files named in `media`. */
  writeText(path: string, contents: string, media: readonly string[]): Promise<void>;
  /** Keeps a picture or sound for the story and resolves to its packed name. */
  putMedia(file: Blob, extension: string): Promise<string>;
  /** Which of these packed files are not on this computer; never reads the files themselves. */
  missingMedia(ids: readonly string[]): Promise<string[]>;
  /** Where the window can load a packed file from. */
  mediaUrl(id: string): string;
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
  | "bad_media"
  | "missing_media"
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
