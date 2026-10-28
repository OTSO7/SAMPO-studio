import { invoke, isTauri } from "@tauri-apps/api/core";

import { serializeStory } from "@core/file";
import { storyMediaIds, type Story } from "@core/model";
import { tauriFileHost } from "./files";
import type { DocumentStore } from "./store";

/**
 * Version history. Complete copies of each story, pictures and sounds included, written into
 * the app's own folder: when a story opens, every ten minutes of editing, before someone
 * else's deletions land, and before leaving or deleting a shared project. A backup failing
 * never stops work.
 */

export interface Backup {
  readonly path: string;
  readonly name: string;
  /** Milliseconds since 1970. */
  readonly modified: number;
  readonly size: number;
}

export type BackupReason =
  "opened" | "autosave" | "before-others-changes" | "shared" | "before-leaving";

const KEEP_NEWEST = 20;
const KEEP_DAILY_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const AUTO_MS = 10 * 60 * 1000;

export async function backupStory(story: Story, reason: BackupReason): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const now = new Date();
    const folder = await invoke<string>("backup_folder", { storyId: story.id });
    const stamp = now.toISOString().replace(/[:.]/gu, "-");
    await tauriFileHost.writeText(
      `${folder}/${stamp} ${reason}.sampo`,
      serializeStory(story, { savedAt: now.toISOString() }),
      storyMediaIds(story),
    );
    const old = backupsToDrop(await listBackups(story.id), now.getTime());
    for (const backup of old) await invoke("delete_backup", { path: backup.path });
    return true;
  } catch {
    return false;
  }
}

/** The story's copies, newest first. */
export async function listBackups(storyId: string): Promise<Backup[]> {
  if (!isTauri()) return [];
  return invoke<Backup[]>("list_backups", { storyId });
}

export function readBackup(path: string): Promise<string> {
  return tauriFileHost.readText(path);
}

/**
 * Which copies to remove: the history keeps the 20 newest, and the newest of each day for
 * 60 days. `backups` is newest first.
 */
export function backupsToDrop(backups: readonly Backup[], now: number): Backup[] {
  const seenDays = new Set<number>();
  return backups.filter((backup, index) => {
    const day = Math.floor(backup.modified / DAY_MS);
    const firstOfDay = !seenDays.has(day);
    seenDays.add(day);
    if (index < KEEP_NEWEST) return false;
    return !(firstOfDay && now - backup.modified < KEEP_DAILY_DAYS * DAY_MS);
  });
}

/** Takes the opening and every-ten-minutes copies for whatever story is open. */
export function watchBackups(document: DocumentStore): () => void {
  let storyId: string | null = null;
  let lastRevision = -1;
  let lastBackup = 0;

  const unsubscribe = document.subscribe((state) => {
    if (state.story === null || state.story.id === storyId) return;
    storyId = state.story.id;
    lastRevision = state.revision;
    lastBackup = Date.now();
    // An empty new story has nothing worth keeping yet.
    if (state.story.phases.length > 0) void backupStory(state.story, "opened");
  });

  const timer = window.setInterval(() => {
    const { story, revision } = document.getState();
    if (story === null || revision === lastRevision || Date.now() - lastBackup < AUTO_MS) return;
    lastRevision = revision;
    lastBackup = Date.now();
    void backupStory(story, "autosave");
  }, 60_000);

  return () => {
    unsubscribe();
    window.clearInterval(timer);
  };
}
