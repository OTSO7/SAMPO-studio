import { createStore, type Store } from "../store";

/**
 * Shared projects this computer belongs to, and their local copies. The list lives in local
 * storage; each project's document and its edits not yet confirmed by the relay live in
 * IndexedDB, both in the app's own data folder. So a project opens, and can be edited, without
 * a connection, and nothing made offline is lost.
 */

export interface ProjectRecord {
  /** The relay's room id. */
  readonly id: string;
  /** The project key, base64url. Never sent anywhere. */
  readonly key: string;
  readonly role: "owner" | "member";
  /** The owner secret or the member token: proves to the relay who this is. */
  readonly secret: string;
  readonly storyId: string;
  readonly title: string;
  readonly ownerName: string;
  readonly myName: string;
  /** The last stored edit this copy has. */
  readonly lastSeq: number;
  /** When this copy last folded the history into a snapshot. */
  readonly snapshotSeq: number;
  /** Pictures and sounds added while offline, sent once the connection is back. */
  readonly unsentMedia?: readonly string[];
  /** The owner's own `.sampo` file, kept up to date too. */
  readonly filePath: string | null;
  readonly openedAt: number;
}

const LIST_KEY = "sampo.projects";

function readList(): ProjectRecord[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(LIST_KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as ProjectRecord[]) : [];
  } catch {
    return [];
  }
}

export const projects: Store<{ list: readonly ProjectRecord[] }> = createStore<{
  list: readonly ProjectRecord[];
}>({
  list: typeof window === "undefined" ? [] : readList(),
});

function writeList(list: readonly ProjectRecord[]): void {
  projects.setState({ list });
  try {
    window.localStorage.setItem(LIST_KEY, JSON.stringify(list));
  } catch {
    // Kept for this run only.
  }
}

export function findProject(predicate: (record: ProjectRecord) => boolean): ProjectRecord | null {
  return projects.getState().list.find(predicate) ?? null;
}

export function saveProject(record: ProjectRecord): void {
  writeList([record, ...projects.getState().list.filter((other) => other.id !== record.id)]);
}

export function updateProject(id: string, patch: Partial<ProjectRecord>): ProjectRecord | null {
  const current = findProject((record) => record.id === id);
  if (current === null) return null;
  const next = { ...current, ...patch };
  writeList(projects.getState().list.map((record) => (record.id === id ? next : record)));
  return next;
}

export function forgetProject(id: string): void {
  writeList(projects.getState().list.filter((record) => record.id !== id));
  void deleteLocal(id);
}

// ---------- the local copy ----------

export interface LocalCopy {
  /** The whole Yjs document. */
  readonly doc: Uint8Array;
  /** Edits made here that the relay has not confirmed yet, oldest first. */
  readonly outbox: readonly Uint8Array[];
}

const DB_NAME = "sampo-projects";
const STORE = "copies";
let database: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  database ??= new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  return database;
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>) {
  return db().then(
    (handle) =>
      new Promise<T | null>((resolve) => {
        if (handle === null) {
          resolve(null);
          return;
        }
        const request = work(handle.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      }),
  );
}

export async function loadLocal(id: string): Promise<LocalCopy | null> {
  const value = await run<LocalCopy | undefined>("readonly", (store) => store.get(id));
  return value ?? null;
}

export async function saveLocal(id: string, copy: LocalCopy): Promise<boolean> {
  return (await run("readwrite", (store) => store.put(copy, id))) !== null;
}

async function deleteLocal(id: string): Promise<void> {
  await run("readwrite", (store) => store.delete(id));
}
