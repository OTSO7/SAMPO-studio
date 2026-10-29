import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";

import { FILE_EXTENSION } from "@core/file";
import { FileError, type FileErrorCode, type FileHost } from "./file-host";
import { opening } from "./opening";

const FILTERS = [{ name: "SAMPO Story", extensions: [FILE_EXTENSION] }];
const EXPORT_FILTERS = {
  csv: [{ name: "CSV spreadsheet", extensions: ["csv"] }],
  md: [{ name: "Markdown", extensions: ["md"] }],
};

const KNOWN_CODES: readonly FileErrorCode[] = [
  "not_found",
  "not_a_story_file",
  "unsupported_export",
  "too_large",
  "bad_media",
  "missing_media",
  "io",
];

/** Matches `CommandError` in `src-tauri/src/commands.rs`. */
interface CommandError {
  code: string;
  message: string;
}

function isCommandError(value: unknown): value is CommandError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<CommandError>).code === "string" &&
    typeof (value as Partial<CommandError>).message === "string"
  );
}

function toFileError(error: unknown): FileError {
  if (isCommandError(error)) {
    const code = KNOWN_CODES.find((known) => known === error.code) ?? "unknown";
    return new FileError(code, error.message);
  }
  return new FileError("unknown", String(error));
}

/** The desktop folder packed files are served from; known after the first file call. */
let mediaFolder: string | null = null;
/** Outside the desktop app (the dev server in a browser) media lives in memory instead. */
const browserMedia = new Map<string, string>();

/** The dev server in a plain browser has no file system; say so instead of failing oddly. */
function desktopOnly(): void {
  if (!isTauri()) {
    throw new FileError(
      "io",
      "Files can only be opened and saved in the SAMPO Studio app, not in a browser tab.",
    );
  }
}

async function ensureMediaFolder(): Promise<void> {
  mediaFolder ??= await invoke<string>("media_folder");
}

export const tauriFileHost: FileHost = {
  async pickOpenPath() {
    desktopOnly();
    const path = await open({ multiple: false, directory: false, filters: FILTERS });
    return typeof path === "string" ? path : null;
  },

  async pickSavePath(suggestedName) {
    desktopOnly();
    return save({ defaultPath: suggestedName, filters: FILTERS });
  },

  async readText(path) {
    desktopOnly();
    opening.setState({ active: true, done: 0, total: 0 });
    const stop = await listen<{ done: number; total: number }>("open-progress", (event) => {
      opening.setState(event.payload);
    }).catch(() => () => undefined);
    try {
      await ensureMediaFolder();
      return await invoke<string>("read_story_file", { path });
    } catch (error) {
      throw toFileError(error);
    } finally {
      stop();
      opening.setState({ active: false, done: 0, total: 0 });
    }
  },

  async writeText(path, contents, media) {
    desktopOnly();
    try {
      await invoke("write_story_file", { path, contents, media });
    } catch (error) {
      throw toFileError(error);
    }
  },

  async putMedia(file, extension) {
    if (!isTauri()) {
      const id = `${crypto.randomUUID().replaceAll("-", "").padEnd(64, "0")}.${extension}`;
      browserMedia.set(id, URL.createObjectURL(file));
      return id;
    }
    try {
      await ensureMediaFolder();
      // Raw bytes, not JSON: a music track would otherwise travel as megabytes of numbers.
      return await invoke<string>("put_media", new Uint8Array(await file.arrayBuffer()), {
        headers: { "x-extension": extension },
      });
    } catch (error) {
      throw toFileError(error);
    }
  },

  async missingMedia(ids) {
    if (!isTauri()) return ids.filter((id) => !browserMedia.has(id));
    try {
      return await invoke<string[]>("missing_media", { ids });
    } catch (error) {
      throw toFileError(error);
    }
  },

  mediaUrl(id) {
    const local = browserMedia.get(id);
    if (local !== undefined) return local;
    return mediaFolder === null ? "" : convertFileSrc(`${mediaFolder}/${id}`);
  },

  async modifiedAt(path) {
    try {
      return await invoke<number | null>("story_file_modified", { path });
    } catch (error) {
      throw toFileError(error);
    }
  },

  async pickExportPath(suggestedName, format) {
    desktopOnly();
    return save({ defaultPath: suggestedName, filters: EXPORT_FILTERS[format] });
  },

  async writeExport(path, contents) {
    try {
      await invoke("write_export_file", { path, contents });
    } catch (error) {
      throw toFileError(error);
    }
  },

  async launchPath() {
    try {
      return await invoke<string | null>("launch_file");
    } catch {
      return null;
    }
  },
};
