import * as Y from "yjs";

import { backupStory } from "../backups";
import { closeStory, type AppDeps } from "../commands";
import {
  ask,
  createStore,
  loadDocument,
  markKept,
  replaceStory,
  showNotice,
  type PromptStore,
  type Store,
} from "../store";
import { storyMediaIds, type Story } from "@core/model";
import {
  base64url,
  formatCode,
  fromBase64url,
  mediaName,
  newHostSecret,
  newSecrets,
  open,
  parseCode,
  projectKeys,
  seal,
  type ProjectKeys,
} from "./crypto";
import {
  findProject,
  forgetProject,
  loadLocal,
  saveLocal,
  saveProject,
  updateProject,
  type ProjectRecord,
} from "./projects";
import { Assembler, splitEdit } from "./pieces";
import { readStory, writeStory } from "./story-doc";

/**
 * Shared projects: one story edited by several people, in real time when they are online
 * together, and catching up on each other's work when they are not. The owner shares an open
 * story and lets each friend in once; after that the project is on everyone's start screen.
 *
 * Every computer keeps the whole project (projects.ts) and works without a connection. Edits
 * travel end to end encrypted through a relay (cloud/), which also keeps them, still
 * encrypted, for whoever was away. Yjs merges them so every copy ends up the same.
 */

/** The relay. A build can point elsewhere with VITE_SAMPO_LIVE_URL. */
const RELAY = (import.meta.env.VITE_SAMPO_LIVE_URL ?? "wss://sampo-cloud.sampo-cloud.workers.dev")
  .replace(/^http/u, "ws")
  .replace(/\/+$/u, "");

export interface Person {
  readonly peer: string;
  readonly name: string;
  /** The card they have open, if any. */
  readonly beatId: string | null;
  /** The text block they are typing in, if any. */
  readonly blockId: string | null;
}

export interface Knock {
  readonly peer: string;
  readonly name: string;
  /** Uses the name of someone already in the project: maybe them again, maybe not. */
  readonly duplicate: boolean;
}

/** For the owner: everyone who belongs to the project, here or not. */
export interface Member {
  readonly member: string;
  readonly name: string;
  readonly online: boolean;
}

/** Bytes on the relay: the story's text, and files still on their way to someone. */
export interface Usage {
  readonly text: number;
  readonly files: number;
  readonly limit: number;
}

export type LiveState =
  | { readonly kind: "off" }
  /** Asking to join with a code; the owner has not let them in yet. */
  | { readonly kind: "joining"; readonly stage: "connecting" | "waiting" }
  | {
      readonly kind: "open";
      readonly project: ProjectRecord;
      readonly connection: "online" | "offline";
      /** The invite code, for the owner to hand out. */
      readonly code: string | null;
      readonly people: readonly Person[];
      readonly knocks: readonly Knock[];
      readonly members: readonly Member[];
      /** Edits made here that have not reached the relay yet. */
      readonly unsent: number;
      /** Whether new people may ask to join (the owner can close the door). */
      readonly invitesOpen: boolean;
      /** What the project holds on the relay, once asked. */
      readonly usage: Usage | null;
    };

export const live: Store<{ state: LiveState }> = createStore({
  state: { kind: "off" } as LiveState,
});

/**
 * The cards and blocks someone else just changed, so they can light up for a moment. `key`
 * changes with every batch, to restart the highlight.
 */
export const liveChanges: Store<{ ids: readonly string[]; key: number }> = createStore({
  ids: [] as readonly string[],
  key: 0,
});

const NAME_KEY = "sampo.liveName";

export function savedName(): string {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberName(name: string): void {
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    // Asked again next time.
  }
}

// Relay frame kinds (cloud/src/index.ts).
const UPDATE = 1;
const EPHEMERAL = 2;
const MEDIA = 3;
const SNAPSHOT = 4;

const MEDIA_PART_BYTES = 512 * 1024;
/** The relay takes a file in at most 200 pieces. */
const MAX_SHARED_FILE_BYTES = 200 * MEDIA_PART_BYTES;
/** With the cloud full, how often to look whether there is room again. */
const FULL_RETRY_MS = 5 * 60_000;
/** An edit whose pieces stop coming for this long was abandoned; its sender resends it. */
const STALE_PIECES_MS = 60_000;
const FLUSH_MS = 60;
const PERSIST_MS = 700;
const PRESENCE_MS = 20_000;
const MEDIA_WAIT_MS = 60_000;
const SNAPSHOT_EVERY = 200;
const BEFORE_CHANGES_BACKUP_MS = 2 * 60 * 1000;
/** Close codes after which reconnecting is pointless. */
const FINAL_CLOSES = new Set([4001, 4002, 4003, 4004, 4005, 4006]);

/** Where a change to the document came from. */
const LOCAL = Symbol("local");
const REMOTE = Symbol("remote");
const LOADED = Symbol("loaded");
/** Sharing itself: goes out, but is not an edit anyone can undo. */
const SEED = Symbol("seed");

let current: Project | null = null;

// ---------- what the app calls ----------

/** Shares the open story as a new project owned by this person. */
export async function shareStory(deps: AppDeps, name: string): Promise<void> {
  const { story, path } = deps.document.getState();
  if (story === null || current !== null) return;
  rememberName(name);
  await backupStory(story, "shared");
  const secrets = newSecrets();
  const record: ProjectRecord = {
    id: secrets.roomId,
    key: base64url(secrets.key),
    role: "owner",
    secret: newHostSecret(),
    storyId: story.id,
    title: story.title,
    ownerName: name,
    myName: name,
    lastSeq: 0,
    snapshotSeq: 0,
    filePath: path,
    openedAt: Date.now(),
  };
  saveProject(record);
  current = new Project(deps, record, await projectKeys(secrets.key));
  current.seed(story);
  current.connect(true);
}

/** Asks to join with a code from the owner. Resolves to `false` when it is not a code. */
export async function joinProject(deps: AppDeps, code: string, name: string): Promise<boolean> {
  const secrets = parseCode(code);
  if (secrets === null || current !== null) return false;
  const known = findProject((record) => record.id === secrets.roomId);
  if (known !== null) {
    await openProject(deps, known);
    return true;
  }
  if (!(await closeStory(deps))) return false;
  rememberName(name);
  const record: ProjectRecord = {
    id: secrets.roomId,
    key: base64url(secrets.key),
    role: "member",
    secret: "",
    storyId: "",
    title: "",
    ownerName: "",
    myName: name,
    lastSeq: 0,
    snapshotSeq: 0,
    filePath: null,
    openedAt: Date.now(),
  };
  current = new Project(deps, record, await projectKeys(secrets.key));
  current.connect(false);
  return true;
}

/** Opens a project from the start screen, or when its owner opens the story's file. */
export async function openProject(deps: AppDeps, record: ProjectRecord): Promise<void> {
  if (current?.record.id === record.id) return;
  // Another story open: it is saved or the user is asked first, as when opening any file.
  const open = deps.document.getState().story;
  if (open !== null && open.id !== record.storyId && !(await closeStory(deps))) return;
  current?.stop();
  const project = new Project(deps, record, await projectKeys(fromBase64url(record.key)));
  current = project;
  await project.loadLocalCopy();
  project.connect(false);
}

/** Stops syncing the open project; it stays on the start screen. */
export function closeProject(): void {
  current?.stop();
}

/**
 * A member leaves for good; the owner deletes the project for everyone. Either way this
 * computer keeps a copy in the version history first, and the owner keeps their file.
 */
export async function leaveProject(deps: AppDeps, prompts: PromptStore): Promise<boolean> {
  const project = current;
  if (project === null) return false;
  const owner = project.record.role === "owner";
  if (!(await confirmLeaving(prompts, owner, project.record.title))) return false;
  const story = deps.document.getState().story;
  if (story !== null) await backupStory(story, "before-leaving");
  if (owner) project.control({ t: "delete-project" });
  project.stop();
  forgetProject(project.record.id);
  return true;
}

/**
 * The same from the start screen, without opening the project: its copy on this computer goes
 * into the version history first. Deleting for everyone needs the cloud; offline, nothing
 * changes and the user is told, so they can try again.
 */
export async function removeProjectFromList(
  deps: AppDeps,
  prompts: PromptStore,
  record: ProjectRecord,
): Promise<boolean> {
  const owner = record.role === "owner";
  if (!(await confirmLeaving(prompts, owner, record.title))) return false;
  if (current?.record.id === record.id) current.stop();

  const copy = await loadLocal(record.id);
  if (copy !== null) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, copy.doc, LOADED);
    const story = readStory(doc, null);
    if (story !== null) await backupStory(story, "before-leaving");
  }
  if (owner && !(await deleteOnRelay(record))) {
    showNotice(deps.notices, {
      tone: "error",
      title: "Could not reach the cloud to delete the project. Try again when you are online.",
    });
    return false;
  }
  forgetProject(record.id);
  showNotice(deps.notices, {
    tone: "info",
    title: owner
      ? "Project deleted. A copy is in the version history on this computer."
      : "You left the project. A copy is in the version history on this computer.",
  });
  return true;
}

function confirmLeaving(prompts: PromptStore, owner: boolean, title: string): Promise<boolean> {
  const name = title.trim() === "" ? "this project" : `“${title}”`;
  return ask(prompts, {
    title: owner ? `Delete ${name} for everyone?` : `Leave ${name}?`,
    message: owner
      ? "Are you sure? Friends lose access and it leaves their start screens. This cannot be undone. Your own file and the version history stay on this computer, and each friend keeps a copy in theirs."
      : "Are you sure? It leaves your start screen and you stop receiving changes. To come back, the owner has to invite you again. A copy stays in the version history on this computer.",
    actions: [
      { label: "Cancel", value: "cancel" },
      { label: owner ? "Delete for everyone" : "Leave project", value: "go", tone: "danger" },
    ],
    cancelValue: "cancel",
  }).then((choice) => choice === "go");
}

/** Signs in as the owner just long enough to delete the project on the relay. */
function deleteOnRelay(record: ProjectRecord): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      socket.close();
      resolve(ok);
    };
    const socket = new WebSocket(`${RELAY}/session/${record.id}`);
    const timer = window.setTimeout(() => finish(false), 10_000);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ t: "owner", secret: record.secret }));
    });
    socket.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (typeof event.data !== "string") return;
      const { t } = JSON.parse(event.data) as { t?: string };
      if (t === "welcome") socket.send(JSON.stringify({ t: "delete-project" }));
      // Already gone on the relay counts as deleted.
      if (t === "deleted" || t === "no-project") finish(true);
    });
    socket.addEventListener("error", () => finish(false));
  });
}

export function answerKnock(peer: string, admit: boolean): void {
  current?.control({ t: admit ? "admit" : "deny", peer });
  current?.dropKnock(peer);
}

/** The owner opens or closes the project to new people; closed, a code only meets a closed door. */
export function setInvitesOpen(open: boolean): void {
  current?.control({ t: "invites", open });
}

/** Asks the relay how much the project holds; the answer lands in the live state. */
export function requestUsage(): void {
  current?.control({ t: "usage" });
}

/** The owner removes someone for good. */
export function removeMember(member: string): void {
  current?.control({ t: "revoke", member });
}

/** Tells the others which card this person has open. */
export function shareFocus(beatId: string | null): void {
  current?.focus({ beatId });
}

/** Tells the others which text block this person is typing in. */
export function shareBlock(blockId: string | null): void {
  current?.focus({ blockId });
}

/** In a project, undo and redo only touch this person's own edits. */
export function liveUndo(redo: boolean): boolean {
  if (current === null) return false;
  if (redo) current.undoManager.redo();
  else current.undoManager.undo();
  return true;
}

/**
 * Keeps the open story and its project together: a shared story opened from its file opens as
 * the project (its latest version), and leaving the story disconnects.
 */
export function watchProjects(deps: AppDeps): () => void {
  return deps.document.subscribe((state, previous) => {
    const id = state.story?.id ?? null;
    if (id === (previous.story?.id ?? null)) return;
    if (current !== null && current.record.storyId !== id) current.stop();
    const record = id === null ? null : findProject((r) => r.storyId === id);
    if (record !== null && current === null) {
      if (state.path !== null && record.role === "owner")
        updateProject(record.id, { filePath: state.path });
      void openProject(deps, record);
    }
  });
}

// ---------- the connection ----------

class Project {
  readonly doc = new Y.Doc();
  readonly undoManager: Y.UndoManager;
  private socket: WebSocket | null = null;
  private online = false;
  private pulling = false;
  private stopped = false;
  private retries = 0;
  private peer = "";
  private synced: Story | null = null;
  private applying = false;
  private focusState = { beatId: null as string | null, blockId: null as string | null };
  /** Local edits the relay has not confirmed, oldest first; `sent` of them are on the way. */
  private outbox: Uint8Array[] = [];
  private sent = 0;
  /** Per message on its way: how many outbox edits it carries, how many pieces await a receipt. */
  private inFlight: { count: number; pieces: number }[] = [];
  private readonly assembler = new Assembler();
  /** The highest stored number seen; progress is recorded only up to complete edits. */
  private seenSeq = 0;
  /** Who the relay says this is: "owner" or the member id. */
  private myTag = "";
  /** Relay connection id → who it is, to know who left. */
  private socketPeers = new Map<string, string>();
  private invitesOpen = true;
  private usage: Usage | null = null;
  /** The relay refused something for lack of space; it waits here until there is room. */
  private cloudFull = false;
  private fullNoticeShown = false;
  private fullRetryTimer: number | null = null;
  /** Files already reported as too large, so each is reported once. */
  private tooLarge = new Set<string>();
  private caughtUp = 0;
  private loadedBeforePull = false;
  private flushTimer: number | null = null;
  private persistTimer: number | null = null;
  private presenceTimer: number | null = null;
  private people = new Map<string, Person>();
  private knocks: Knock[] = [];
  private members: Member[] = [];
  /** Remote changes are shown one after another, each once its pictures are here. */
  private showing = Promise.resolve();
  /** Local changes go out one after another, each after its new pictures. */
  private sending = Promise.resolve();
  private incoming = new Map<string, { id: string; parts: Uint8Array[]; got: number }>();
  private wanted = new Map<string, { id: string; done: () => void }>();
  private lastBackup = 0;
  private stopWatching: () => void;

  constructor(
    private readonly deps: AppDeps,
    public record: ProjectRecord,
    private readonly keys: ProjectKeys,
  ) {
    const shared = ["meta", "cardTypes", "entities", "phases", "beats", "blocks"].flatMap(
      (name) => [this.doc.getMap(name), this.doc.getMap(`${name}.places`)],
    );
    this.undoManager = new Y.UndoManager(shared, { trackedOrigins: new Set([LOCAL]) });

    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      // Made here (edits, sharing, undo) go out; from elsewhere, and undo, show. All is kept.
      const undo = origin instanceof Y.UndoManager;
      if (origin === LOCAL || origin === SEED || undo) this.queue(update);
      if (origin === REMOTE || undo) this.show();
      this.persistSoon();
    });

    this.stopWatching = deps.document.subscribe((state, previous) => {
      if (this.applying || state.story === previous.story || state.story === null) return;
      if (this.synced === null || state.story.id !== this.synced.id) return;
      const before = this.synced;
      const after = state.story;
      this.synced = after;
      this.sending = this.sending.then(async () => {
        await this.uploadNewMedia(before, after);
        writeStory(this.doc, before, after, LOCAL);
      });
    });
  }

  /** The owner's first step: the story becomes the project. */
  seed(story: Story): void {
    this.synced = story;
    this.doc.transact(() => {
      this.doc.getMap("meta").set("ownerName", this.record.ownerName);
      writeStory(this.doc, null, story, SEED);
    }, SEED);
    this.publish();
  }

  async loadLocalCopy(): Promise<void> {
    const copy = await loadLocal(this.record.id);
    if (copy !== null) {
      Y.applyUpdate(this.doc, copy.doc, LOADED);
      this.outbox = [...copy.outbox];
    }
    const story = readStory(this.doc, null);
    if (story !== null) this.load(story);
    this.publish();
  }

  connect(create: boolean): void {
    if (this.stopped) return;
    const socket = new WebSocket(`${RELAY}/session/${this.record.id}`);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.addEventListener("open", () => void this.introduce(create));
    socket.addEventListener("message", (event: MessageEvent<string | ArrayBuffer>) => {
      // Malformed input from the relay or a participant is dropped, never trusted.
      if (typeof event.data === "string") {
        try {
          this.onControl(JSON.parse(event.data) as Control);
        } catch {
          // Not a control message.
        }
      } else {
        this.onData(new Uint8Array(event.data)).catch(() => undefined);
      }
    });
    socket.addEventListener("close", (event) => this.onClose(event.code, create));
  }

  private async introduce(create: boolean): Promise<void> {
    this.retries = 0;
    if (this.record.role === "owner") {
      this.control({ t: "owner", secret: this.record.secret, create });
    } else if (this.record.secret !== "") {
      this.control({ t: "member", token: this.record.secret });
    } else {
      const hello = await seal(
        this.keys.seal,
        new TextEncoder().encode(JSON.stringify({ name: this.record.myName })),
      );
      this.control({ t: "hello", hello: base64url(hello) });
      live.setState({ state: { kind: "joining", stage: "connecting" } });
    }
  }

  private onControl(message: Control): void {
    switch (message.t) {
      case "welcome":
        this.peer = message.peer;
        this.myTag = message.role === "owner" ? "owner" : (message.member ?? "");
        this.online = true;
        this.pulling = true;
        this.seenSeq = this.record.lastSeq;
        this.caughtUp = 0;
        this.loadedBeforePull = this.synced !== null;
        this.cloudFull = false;
        this.control({ t: "pull", after: this.record.lastSeq });
        this.sendPresence();
        this.presenceTimer ??= window.setInterval(() => this.sendPresence(), PRESENCE_MS);
        this.publish();
        return;
      case "pulled":
        this.pulling = false;
        this.seen(message.upTo);
        this.flush();
        void this.syncMedia();
        this.compact();
        this.control({ t: "usage" });
        if (this.caughtUp > 0 && this.loadedBeforePull) {
          showNotice(this.deps.notices, {
            tone: "info",
            title: "Up to date. What others changed while you were away is lit up for a moment.",
          });
        }
        // Pieces of an edit its sender abandoned would hold progress back for good.
        window.setTimeout(() => {
          this.assembler.dropStale(Date.now() - STALE_PIECES_MS);
          this.seen(0);
        }, STALE_PIECES_MS + 1000);
        return;
      case "stored": {
        const head = this.inFlight[0];
        if (head === undefined) return;
        head.pieces -= 1;
        this.seen(message.seq);
        if (head.pieces > 0) return;
        // Every piece of the message is stored: its edits are safe on the relay.
        this.inFlight.shift();
        this.outbox.splice(0, head.count);
        this.sent = Math.max(0, this.sent - head.count);
        this.persistSoon();
        this.publish();
        return;
      }
      case "waiting":
        live.setState({ state: { kind: "joining", stage: "waiting" } });
        return;
      case "admitted":
        this.record = { ...this.record, secret: message.token };
        return;
      case "knock":
        void this.onKnock(message.peer, message.hello);
        return;
      case "members":
        void this.onMembers(message.list);
        return;
      case "joined":
        this.sendPresence();
        return;
      case "left": {
        const tag = this.socketPeers.get(message.peer);
        if (tag !== undefined) this.people.delete(tag);
        this.socketPeers.delete(message.peer);
        this.publish();
        return;
      }
      case "invites":
        this.invitesOpen = message.open;
        this.publish();
        return;
      case "storage-full":
        this.cloudFull = true;
        if (message.kind === "update") {
          // Refused: nothing unconfirmed leaves the outbox, and all of it goes again later.
          // Receipts still on their way belong to messages sent again too, so none are counted.
          this.inFlight = [];
          this.sent = 0;
        } else if (message.name !== undefined) {
          void this.rememberRefused(message.name);
        }
        if (!this.fullNoticeShown) {
          this.fullNoticeShown = true;
          showNotice(this.deps.notices, {
            tone: "error",
            title:
              "The project's cloud space is full. Your changes are kept on this computer and sent automatically once there is room.",
          });
        }
        this.retryWhenRoom();
        return;
      case "usage": {
        this.usage = { text: message.text, files: message.files, limit: message.limit };
        this.publish();
        if (!this.cloudFull) return;
        // Room again once a tenth is free: what waited goes now.
        if (message.text + message.files < message.limit * 0.9) {
          this.cloudFull = false;
          this.fullNoticeShown = false;
          this.flush();
          void this.sendUnsentMedia();
        } else {
          this.retryWhenRoom();
        }
        return;
      }
      case "media-wanted":
        void this.serveMedia(message.names);
        return;
      case "closed":
        this.end("The owner is not letting new people join right now.", true);
        return;
      case "no-project":
      case "deleted":
        this.end(
          this.record.storyId === ""
            ? "That project no longer exists, or the code is wrong."
            : "The owner deleted this project. Your copy stays open and in the version history.",
          true,
        );
        return;
      case "removed":
        this.end("You were removed from the project. Your copy stays open.", true);
        return;
      case "denied":
        this.end("The owner did not let you in.", true);
        return;
      case "full":
        this.end("That project has as many members as it can have.", true);
        return;
    }
  }

  // ---------- incoming ----------

  private async onData(frame: Uint8Array): Promise<void> {
    switch (frame[0]) {
      case UPDATE: {
        const seq = new DataView(frame.buffer, frame.byteOffset + 1, 4).getUint32(0);
        const piece = await open(this.keys.seal, frame.subarray(5));
        if (piece === null) return; // Not sealed with this project's key.
        const edit = this.assembler.add(piece, seq);
        if (edit !== null) {
          Y.applyUpdate(this.doc, edit, REMOTE);
          if (this.pulling) this.caughtUp += 1;
        }
        this.seen(seq);
        return;
      }
      case EPHEMERAL: {
        // The relay stamps who sent it; that, not what the message says, decides the name.
        const length = frame[1] ?? 0;
        const sender = new TextDecoder().decode(frame.subarray(2, 2 + length));
        const plain = await open(this.keys.seal, frame.subarray(2 + length));
        if (plain !== null) this.onPresence(plain, sender);
        return;
      }
      case MEDIA:
        await this.onMediaPart(frame);
        return;
    }
  }

  private onPresence(plain: Uint8Array, sender: string): void {
    if (sender === "" || sender === this.myTag) return;
    const person = JSON.parse(new TextDecoder().decode(plain)) as Partial<Person>;
    if (typeof person.peer === "string") this.socketPeers.set(person.peer, sender);
    this.people.set(sender, {
      peer: sender,
      name: this.nameOf(sender),
      beatId: typeof person.beatId === "string" ? person.beatId : null,
      blockId: typeof person.blockId === "string" ? person.blockId : null,
    });
    this.publish();
  }

  /** The name someone was let in under, or the owner's. */
  private nameOf(tag: string): string {
    if (tag === "owner") {
      return this.doc.getMap<string>("meta").get("ownerName") ?? this.record.ownerName;
    }
    return this.members.find((member) => member.member === tag)?.name ?? "…";
  }

  /** The newcomer's name is sealed with the project key: one that does not open never had it. */
  private async onKnock(peer: string, hello: string): Promise<void> {
    const name = await this.openName(hello);
    if (name === null) {
      this.control({ t: "deny", peer });
      return;
    }
    const taken = [this.record.myName, ...this.members.map((member) => member.name)];
    const duplicate = taken.some(
      (other) => other.trim().toLowerCase() === name.trim().toLowerCase(),
    );
    this.knocks = [
      ...this.knocks.filter((knock) => knock.peer !== peer),
      { peer, name, duplicate },
    ];
    this.publish();
  }

  private async onMembers(list: readonly { member: string; hello: string; online: boolean }[]) {
    const members: Member[] = [];
    for (const entry of list) {
      members.push({
        member: entry.member,
        name: (await this.openName(entry.hello)) ?? "?",
        online: entry.online,
      });
    }
    this.members = members;
    // Names follow the member list; someone who went offline is no longer here.
    for (const [tag, person] of this.people) {
      const member = members.find((m) => m.member === tag);
      if (member !== undefined && !member.online) this.people.delete(tag);
      else this.people.set(tag, { ...person, name: this.nameOf(tag) });
    }
    this.publish();
  }

  private async openName(hello: string): Promise<string | null> {
    try {
      const plain = await open(this.keys.seal, fromBase64url(hello));
      if (plain === null) return null;
      const { name } = JSON.parse(new TextDecoder().decode(plain)) as { name?: unknown };
      return typeof name === "string" && name.trim() !== "" ? name.slice(0, 40) : null;
    } catch {
      return null;
    }
  }

  dropKnock(peer: string): void {
    this.knocks = this.knocks.filter((knock) => knock.peer !== peer);
    this.publish();
  }

  /** Shows the document's story, once the pictures it needs are on this computer. */
  private show(): void {
    this.showing = this.showing.then(async () => {
      const next = readStory(this.doc, this.synced);
      if (next === null || next === this.synced) return;
      await this.fetchMedia(storyMediaIds(next));
      const latest = readStory(this.doc, this.synced) ?? next;
      if (this.synced === null) {
        this.load(latest);
        return;
      }
      const before = this.synced;
      // Someone else removed things: keep a copy from just before, in case it was a mistake.
      if (
        removesSomething(before, latest) &&
        Date.now() - this.lastBackup > BEFORE_CHANGES_BACKUP_MS
      ) {
        this.lastBackup = Date.now();
        await backupStory(before, "before-others-changes");
      }
      this.synced = latest;
      this.applying = true;
      replaceStory(this.deps.document, latest);
      this.applying = false;
      const ids = changedIds(before, latest);
      if (ids.length > 0) liveChanges.setState((state) => ({ ids, key: state.key + 1 }));
    });
  }

  /** The project's story becomes the open story, for the first time in this run. */
  private load(story: Story): void {
    this.synced = story;
    const ownerName = this.doc.getMap<string>("meta").get("ownerName") ?? this.record.ownerName;
    this.setRecord({ storyId: story.id, title: story.title, ownerName, openedAt: Date.now() });
    if (this.record.secret !== "" && findProject((r) => r.id === this.record.id) === null) {
      saveProject(this.record);
    }
    this.applying = true;
    loadDocument(
      this.deps.document,
      story,
      this.record.role === "owner" ? this.record.filePath : null,
    );
    this.applying = false;
  }

  // ---------- outgoing ----------

  private queue(update: Uint8Array): void {
    this.outbox.push(update);
    this.flushTimer ??= window.setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, FLUSH_MS);
    this.publish();
  }

  /** Sends what has not been sent yet, as one message. Only after catching up. */
  private flush(): void {
    if (!this.online || this.pulling || this.cloudFull || this.sent >= this.outbox.length) return;
    const batch = this.outbox.slice(this.sent);
    const merged = batch.length === 1 ? (batch[0] ?? new Uint8Array()) : Y.mergeUpdates(batch);
    const count = batch.length;
    this.sent = this.outbox.length;
    // Large edits go in pieces under the relay's message limit, sealed one by one.
    const pieces = splitEdit(merged);
    void Promise.all(pieces.map((piece) => seal(this.keys.seal, piece))).then((sealed) => {
      if (!this.online) return; // Sent again after reconnecting.
      this.inFlight.push({ count, pieces: sealed.length });
      for (const frame of sealed) this.sendFrame(UPDATE, frame);
    });
  }

  /** Records progress up to the last edit that is completely here. */
  private seen(seq: number): void {
    this.seenSeq = Math.max(this.seenSeq, seq);
    const oldest = this.assembler.oldestIncomplete();
    const safe = oldest === null ? this.seenSeq : Math.min(this.seenSeq, oldest - 1);
    if (safe > this.record.lastSeq) this.setRecord({ lastSeq: safe });
  }

  /** Once the stored history is long, this copy folds it into one snapshot. */
  private compact(): void {
    if (this.record.role !== "owner" || this.outbox.length > 0) return;
    if (this.record.lastSeq - this.record.snapshotSeq < SNAPSHOT_EVERY) return;
    const upTo = this.record.lastSeq;
    const pieces = splitEdit(Y.encodeStateAsUpdate(this.doc));
    if (pieces.length > upTo) return; // The relay numbers the pieces just below upTo.
    void Promise.all(pieces.map((piece) => seal(this.keys.seal, piece))).then((sealed) => {
      if (this.socket?.readyState !== WebSocket.OPEN || !this.online) return;
      sealed.forEach((body, part) => {
        const frame = new Uint8Array(9 + body.length);
        frame[0] = SNAPSHOT;
        const view = new DataView(frame.buffer, 1, 8);
        view.setUint32(0, upTo);
        view.setUint16(4, part);
        view.setUint16(6, sealed.length);
        frame.set(body, 9);
        this.socket?.send(frame);
      });
      this.setRecord({ snapshotSeq: upTo });
    });
  }

  focus(change: { beatId?: string | null; blockId?: string | null }): void {
    const next = { ...this.focusState, ...change };
    if (next.beatId === this.focusState.beatId && next.blockId === this.focusState.blockId) return;
    this.focusState = next;
    this.sendPresence();
  }

  private sendPresence(): void {
    const person: Person = {
      peer: this.peer,
      name: this.record.myName,
      beatId: this.focusState.beatId,
      blockId: this.focusState.blockId,
    };
    void seal(this.keys.seal, new TextEncoder().encode(JSON.stringify(person))).then((sealed) =>
      this.sendFrame(EPHEMERAL, sealed),
    );
  }

  private sendFrame(kind: number, body: Uint8Array): void {
    if (this.socket?.readyState !== WebSocket.OPEN || !this.online) return;
    const frame = new Uint8Array(1 + body.length);
    frame[0] = kind;
    frame.set(body, 1);
    this.socket.send(frame);
  }

  control(message: object): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  // ---------- pictures and sounds ----------

  private async hasMedia(id: string): Promise<boolean> {
    const url = this.deps.files.mediaUrl(`media:${id}`);
    if (url === "") return false;
    try {
      return (await fetch(url)).ok;
    } catch {
      return false;
    }
  }

  /** Fetches pictures this computer does not have from the relay, waiting a while for them. */
  private async fetchMedia(ids: readonly string[]): Promise<void> {
    if (!this.online) return;
    const names: string[] = [];
    const arrived: Promise<void>[] = [];
    for (const id of ids) {
      if (await this.hasMedia(id)) continue;
      const name = await mediaName(this.keys, id);
      names.push(name);
      arrived.push(new Promise((done) => this.wanted.set(name, { id, done })));
    }
    if (names.length === 0) return;
    this.control({ t: "media-get", names });
    await Promise.race([Promise.all(arrived), new Promise((r) => setTimeout(r, MEDIA_WAIT_MS))]);
  }

  /**
   * After catching up: sends pictures added while offline, confirms the ones this computer
   * has (so the relay can let them go), and fetches the ones it lacks.
   */
  private async syncMedia(): Promise<void> {
    const story = this.synced;
    if (story === null) return;
    const used = new Set(storyMediaIds(story));
    await this.sendUnsentMedia();

    const here: string[] = [];
    for (const id of used) {
      if (await this.hasMedia(id)) here.push(await mediaName(this.keys, id));
    }
    if (here.length > 0) this.control({ t: "media-ack", names: here });
    void this.fetchMedia([...used]);
  }

  private async uploadNewMedia(before: Story, after: Story): Promise<void> {
    const known = new Set(storyMediaIds(before));
    const added = storyMediaIds(after).filter((id) => !known.has(id));
    for (const id of added) await this.uploadOne(id, await mediaName(this.keys, id));
  }

  /** Someone needs files the relay no longer holds: this computer sends the ones it has. */
  private async serveMedia(names: readonly string[]): Promise<void> {
    const story = this.synced;
    if (story === null) return;
    const byName = new Map<string, string>();
    for (const id of storyMediaIds(story)) byName.set(await mediaName(this.keys, id), id);
    for (const name of names) {
      const id = byName.get(name);
      if (id !== undefined) await this.uploadOne(id, name);
    }
  }

  private async uploadOne(id: string, name: string): Promise<void> {
    // Offline, or no room in the cloud: remembered, and sent once that changes.
    if (!this.online || this.cloudFull) {
      this.keepUnsent(id);
      return;
    }
    let bytes: Uint8Array;
    try {
      const response = await fetch(this.deps.files.mediaUrl(`media:${id}`));
      if (!response.ok) return;
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch {
      return;
    }
    if (bytes.length > MAX_SHARED_FILE_BYTES) {
      if (!this.tooLarge.has(id)) {
        this.tooLarge.add(id);
        showNotice(this.deps.notices, {
          tone: "error",
          title: `${this.mediaLabel(id)} is ${Math.round(bytes.length / (1024 * 1024))} MB, more than the 100 MB a shared project can pass on. It stays on this computer; the others see it as missing.`,
        });
      }
      return;
    }
    // The id goes along inside the encryption, so the receiver knows what it is.
    const plain = new TextEncoder().encode(`${id}\n`);
    const parts = Math.max(1, Math.ceil(bytes.length / MEDIA_PART_BYTES));
    const nameBytes = new TextEncoder().encode(name);
    for (let part = 0; part < parts; part++) {
      const chunk = bytes.subarray(part * MEDIA_PART_BYTES, (part + 1) * MEDIA_PART_BYTES);
      const body = part === 0 ? concat(plain, chunk) : chunk;
      const sealed = await seal(this.keys.seal, body);
      const frame = new Uint8Array(1 + nameBytes.length + 4 + sealed.length);
      frame[0] = nameBytes.length;
      frame.set(nameBytes, 1);
      const view = new DataView(frame.buffer, 1 + nameBytes.length, 4);
      view.setUint16(0, part);
      view.setUint16(2, parts);
      frame.set(sealed, 1 + nameBytes.length + 4);
      this.sendFrame(MEDIA, frame);
    }
  }

  /** Sends the files kept back while offline or while the cloud was full. */
  private async sendUnsentMedia(): Promise<void> {
    const story = this.synced;
    if (story === null) return;
    const used = new Set(storyMediaIds(story));
    const unsent = (this.record.unsentMedia ?? []).filter((id) => used.has(id));
    this.setRecord({ unsentMedia: [] });
    for (const id of unsent) await this.uploadOne(id, await mediaName(this.keys, id));
  }

  private keepUnsent(id: string): void {
    const unsent = new Set(this.record.unsentMedia ?? []);
    unsent.add(id);
    this.setRecord({ unsentMedia: [...unsent] });
  }

  /** The relay refused this file for lack of room: keep it to send again. */
  private async rememberRefused(name: string): Promise<void> {
    const story = this.synced;
    if (story === null) return;
    for (const id of storyMediaIds(story)) {
      if ((await mediaName(this.keys, id)) === name) this.keepUnsent(id);
    }
  }

  /** Asks again in a while whether the cloud has room. */
  private retryWhenRoom(): void {
    if (this.fullRetryTimer !== null) return;
    this.fullRetryTimer = window.setTimeout(() => {
      this.fullRetryTimer = null;
      this.control({ t: "usage" });
    }, FULL_RETRY_MS);
  }

  /** "A picture", "The sound “Tuuli”", for messages about one file. */
  private mediaLabel(id: string): string {
    for (const phase of this.synced?.phases ?? []) {
      for (const beat of phase.beats) {
        for (const block of beat.blocks) {
          if (block.type === "image" && block.src === `media:${id}`) return "A picture";
          if (block.type === "audio" && block.src === `media:${id}`) {
            return block.text === "" ? "A sound" : `The sound “${block.text}”`;
          }
          if (block.type === "line" && block.take === `media:${id}`) return "A recorded take";
        }
      }
    }
    return "A file";
  }

  private async onMediaPart(frame: Uint8Array): Promise<void> {
    const length = frame[1] ?? 0;
    const name = new TextDecoder().decode(frame.subarray(2, 2 + length));
    const want = this.wanted.get(name);
    if (want === undefined || frame.length < 2 + length + 4) return;
    const view = new DataView(frame.buffer, frame.byteOffset + 2 + length, 4);
    const part = view.getUint16(0);
    const parts = view.getUint16(2);
    if (parts === 0 || parts > 200 || part >= parts) return;
    let plain = await open(this.keys.seal, frame.subarray(2 + length + 4));
    if (plain === null) return;
    if (part === 0) {
      const newline = plain.indexOf(10);
      if (newline === -1 || new TextDecoder().decode(plain.subarray(0, newline)) !== want.id)
        return;
      plain = plain.subarray(newline + 1);
    }
    const entry = this.incoming.get(name) ?? {
      id: want.id,
      parts: new Array<Uint8Array>(parts),
      got: 0,
    };
    if (entry.parts[part] === undefined) entry.got += 1;
    entry.parts[part] = plain;
    this.incoming.set(name, entry);
    if (entry.got < parts) return;
    this.incoming.delete(name);
    // Stored under its own hash: a damaged or false file gets another name and is ignored.
    const ref = await this.deps.files.putMedia(
      new Blob(entry.parts as BlobPart[]),
      want.id.split(".").pop() ?? "",
    );
    if (ref === `media:${want.id}`) {
      this.wanted.delete(name);
      want.done();
      // Here now: once everyone has confirmed, the relay deletes its copy.
      this.control({ t: "media-ack", names: [name] });
    }
  }

  // ---------- keeping it ----------

  private persistSoon(): void {
    if (this.persistTimer !== null || this.record.storyId === "") return;
    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = null;
      void this.persist();
    }, PERSIST_MS);
  }

  private async persist(): Promise<void> {
    const revision = this.deps.document.getState().revision;
    const saved = await saveLocal(this.record.id, {
      doc: Y.encodeStateAsUpdate(this.doc),
      outbox: this.outbox,
    });
    const story = this.synced;
    if (story !== null) this.setRecord({ title: story.title });
    // Without a file the copy here is what keeps it, so the story counts as saved.
    if (saved && this.deps.document.getState().path === null && !this.stopped) {
      markKept(this.deps.document, revision, new Date());
    }
  }

  private setRecord(patch: Partial<ProjectRecord>): void {
    this.record = { ...this.record, ...patch };
    if (this.record.secret !== "") updateProject(this.record.id, patch);
    this.publish();
  }

  // ---------- the end ----------

  private onClose(code: number, create: boolean): void {
    this.online = false;
    this.sent = 0;
    this.inFlight = [];
    this.publish();
    if (this.stopped || FINAL_CLOSES.has(code)) return;
    // Dropped connection: try again, sooner at first. Edits keep landing locally meanwhile.
    this.retries += 1;
    window.setTimeout(
      () => this.connect(create && this.record.lastSeq === 0),
      Math.min(30_000, 1000 * 2 ** Math.min(this.retries, 5)),
    );
  }

  stop(): void {
    if (this.stopped) return;
    if (this.persistTimer !== null) {
      window.clearTimeout(this.persistTimer);
      this.persistTimer = null;
      void this.persist();
    }
    this.stopped = true;
    this.stopWatching();
    if (this.presenceTimer !== null) window.clearInterval(this.presenceTimer);
    if (this.fullRetryTimer !== null) window.clearTimeout(this.fullRetryTimer);
    this.socket?.close();
    this.undoManager.destroy();
    if (current === this) current = null;
    live.setState({ state: { kind: "off" } });
  }

  /** Over for this computer. The local copy goes only after a backup of it is written. */
  private end(message: string, forget: boolean): void {
    const id = this.record.id;
    const known = this.record.storyId !== "";
    const story = this.synced;
    this.stop();
    showNotice(this.deps.notices, { tone: "info", title: message });
    if (!forget || !known) return;
    void (story === null ? Promise.resolve(true) : backupStory(story, "before-leaving")).then(() =>
      forgetProject(id),
    );
  }

  private publish(): void {
    if (this.stopped) return;
    if (this.record.secret === "" && this.record.role === "member") return; // Still knocking.
    live.setState({
      state: {
        kind: "open",
        project: this.record,
        connection: this.online ? "online" : "offline",
        code:
          this.record.role === "owner"
            ? formatCode({ roomId: this.record.id, key: fromBase64url(this.record.key) })
            : null,
        people: [...this.people.values()],
        knocks: this.knocks,
        invitesOpen: this.invitesOpen,
        usage: this.usage,
        members: this.members,
        unsent: this.outbox.length,
      },
    });
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** Whether `after` lacks a phase, card or block `before` had. */
function removesSomething(before: Story, after: Story): boolean {
  const ids = new Set<string>();
  for (const phase of after.phases) {
    ids.add(phase.id);
    for (const beat of phase.beats) {
      ids.add(beat.id);
      for (const block of beat.blocks) ids.add(block.id);
    }
  }
  return before.phases.some(
    (phase) =>
      !ids.has(phase.id) ||
      phase.beats.some((beat) => !ids.has(beat.id) || beat.blocks.some((b) => !ids.has(b.id))),
  );
}

/** Cards and blocks that differ: unchanged parts keep their objects (readStory). */
function changedIds(before: Story, after: Story): string[] {
  const beats = new Map(before.phases.flatMap((phase) => phase.beats.map((b) => [b.id, b])));
  const ids: string[] = [];
  for (const phase of after.phases) {
    for (const beat of phase.beats) {
      const was = beats.get(beat.id);
      if (was === beat) continue;
      const blocks = new Set(was?.blocks ?? []);
      const changedBlocks = beat.blocks.filter((block) => !blocks.has(block));
      ids.push(...changedBlocks.map((block) => block.id));
      // A card counts itself when its own fields changed, or it is new.
      if (was === undefined || changedBlocks.length === 0) ids.push(beat.id);
    }
  }
  return ids.slice(0, 50);
}

type Control =
  | { t: "welcome"; peer: string; role: "owner" | "member"; member?: string }
  | { t: "pulled"; upTo: number }
  | { t: "stored"; seq: number }
  | { t: "admitted"; token: string }
  | { t: "knock"; peer: string; hello: string }
  | { t: "members"; list: { member: string; hello: string; online: boolean }[] }
  | { t: "joined" | "left"; peer: string }
  | { t: "media-wanted"; names: string[] }
  | { t: "usage"; text: number; files: number; limit: number }
  | { t: "invites"; open: boolean }
  | {
      t: "waiting" | "no-project" | "deleted" | "removed" | "denied" | "full" | "closed";
    }
  | { t: "storage-full"; kind: "update" | "media"; name?: string };
