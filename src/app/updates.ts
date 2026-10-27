import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

export interface AvailableUpdate {
  readonly version: string;
  /** Downloads and installs the update, then restarts the app. */
  readonly install: () => Promise<void>;
}

/**
 * Asks the release server for a newer version. Resolves with null when the app is current,
 * when the check cannot be made (offline, no release yet) or when it fails. Updates are
 * optional, so a failed check never reaches the user as an error.
 */
export async function findUpdate(): Promise<AvailableUpdate | null> {
  try {
    return await checkForUpdate();
  } catch (error) {
    console.warn("Update check failed", error);
    return null;
  }
}

/**
 * The same check for when the author asks: a failure is reported, so being offline is never
 * mistaken for being up to date.
 */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  const update = await check();
  if (update === null) return null;
  return {
    version: update.version,
    install: async () => {
      await update.downloadAndInstall();
      await relaunch();
    },
  };
}
