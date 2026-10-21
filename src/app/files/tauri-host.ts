import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

import { FILE_EXTENSION } from "@core/file";
import { FileError, type FileErrorCode, type FileHost } from "./file-host";

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

export const tauriFileHost: FileHost = {
  async pickOpenPath() {
    const path = await open({ multiple: false, directory: false, filters: FILTERS });
    return typeof path === "string" ? path : null;
  },

  async pickSavePath(suggestedName) {
    return save({ defaultPath: suggestedName, filters: FILTERS });
  },

  async readText(path) {
    try {
      return await invoke<string>("read_story_file", { path });
    } catch (error) {
      throw toFileError(error);
    }
  },

  async writeText(path, contents) {
    try {
      await invoke("write_story_file", { path, contents });
    } catch (error) {
      throw toFileError(error);
    }
  },

  async pickExportPath(suggestedName, format) {
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
