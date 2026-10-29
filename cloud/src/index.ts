/**
 * SAMPO Studio shared projects: a relay and an encrypted mailbox for co-editing. One Durable
 * Object per project:
 *
 * - Everything the app sends is end-to-end encrypted with the project key, which never reaches
 *   this server. It stores and passes on ciphertext; it never sees a story, a name or a picture.
 * - It keeps the project's encrypted edits, so whoever comes online catches up on what the
 *   others did meanwhile, also when the owner's computer is off.
 * - Pictures and sounds are only passing through: kept until every member has confirmed they
 *   have one, at most two weeks, then deleted. Members' computers keep them; one who needs a
 *   file the relay no longer has gets it from whoever has it and is online.
 * - Only members get anything. The owner admits each new person once; they get a member token
 *   and come back with it any time. The owner can remove members, close the project to new
 *   people, and delete it.
 *
 * Frames: JSON text for control; binary for data, with a kind byte the server can read. The
 * app splits anything large into pieces under Cloudflare's 1 MiB message limit itself.
 *   1 update     stored, numbered, passed on     server → client: [1][seq u32][ciphertext]
 *   2 ephemeral  passed on only (presence)       server → client: [2][sender len][sender][ct]
 *   3 media      a part of a picture or sound     [3][name len][name][part u16][parts u16][ct]
 *   4 snapshot   owner only: one piece of a state replacing stored edits ≤ upTo
 *                                                 [4][upTo u32][part u16][parts u16][ct]
 */
import { DurableObject } from "cloudflare:workers";

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  /** Free-plan rate limit (wrangler.jsonc), so no one can use up the daily free quota. */
  CONNECT_LIMIT: RateLimit;
  /** Local testing only: a smaller project limit, e.g. `wrangler dev --var PROJECT_LIMIT_BYTES:4000`. */
  PROJECT_LIMIT_BYTES?: string;
}

const ROOM_PATH = /^\/session\/([A-Za-z0-9_-]{22})$/u;
const SECRET = /^[A-Za-z0-9_-]{43}$/u;
const MEDIA_NAME = /^[0-9a-f]{64}$/u;
/** Cloudflare's WebSocket message limit is 1 MiB. */
const MAX_MESSAGE_BYTES = 1024 * 1024;
const MAX_HELLO_CHARS = 4096;
const MAX_MEMBERS = 16;
/**
 * One project may hold this much. Cloudflare's free plan allows 5 GB in all, and possibly no more
 * than 1 GB per Durable Object, so this stays under both with a clear message of its own.
 */
const MAX_PROJECT_BYTES = 900 * 1024 * 1024;
/** A file in transit nobody collects is dropped after this; its senders still have it. */
const MEDIA_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
/** A project nobody opens for this long is deleted. */
const IDLE_MS = 180 * 24 * 60 * 60 * 1000;

const UPDATE = 1;
const EPHEMERAL = 2;
const MEDIA = 3;
const SNAPSHOT = 4;

export default {
  async fetch(request, env) {
    const match = ROOM_PATH.exec(new URL(request.url).pathname);
    if (match?.[1] === undefined) {
      return new Response("SAMPO Studio shared projects\n", { status: 404 });
    }
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket", { status: 426 });
    }
    const address = request.headers.get("CF-Connecting-IP") ?? "local";
    if (!(await env.CONNECT_LIMIT.limit({ key: address })).success) {
      return new Response("Too many connections, try again in a minute", { status: 429 });
    }
    return env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(request);
  },
} satisfies ExportedHandler<Env>;

/** Kept on each socket, so it survives the object hibernating between messages. */
interface Seat {
  peer: string;
  role: "owner" | "member" | "guest";
  /** The member id, once known. */
  member?: string;
  /** A newcomer's encrypted introduction, shown to the owner as a knock. */
  hello?: string;
}

type Control =
  | { t: "owner"; secret: string; create?: boolean; peek?: boolean }
  | { t: "member"; token: string; peek?: boolean }
  | { t: "hello"; hello?: string }
  | { t: "admit" | "deny"; peer: string }
  | { t: "revoke"; member: string }
  | { t: "invites"; open: boolean }
  | { t: "pull"; after: number }
  | { t: "media-get" | "media-ack"; names: string[] }
  | { t: "usage" }
  | { t: "delete-project" };

export class Room extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.createTables();
  }

  /** Also after deleting a project: the object lives on, and may host it again. */
  private createTables() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS media (
        name TEXT NOT NULL, part INTEGER NOT NULL, parts INTEGER NOT NULL, data BLOB NOT NULL,
        PRIMARY KEY (name, part)
      );
      CREATE TABLE IF NOT EXISTS members (
        member TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, hello TEXT NOT NULL,
        created INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS media_acks (
        name TEXT NOT NULL, who TEXT NOT NULL, PRIMARY KEY (name, who)
      );
      CREATE TABLE IF NOT EXISTS media_wants (
        name TEXT NOT NULL, who TEXT NOT NULL, PRIMARY KEY (name, who)
      );
      CREATE TABLE IF NOT EXISTS snapshot_parts (
        up_to INTEGER NOT NULL, part INTEGER NOT NULL, parts INTEGER NOT NULL, data BLOB NOT NULL,
        PRIMARY KEY (up_to, part)
      );
    `);
    // Projects from before pictures had a time: theirs count as old.
    try {
      this.sql.exec("ALTER TABLE media ADD COLUMN created INTEGER NOT NULL DEFAULT 0");
    } catch {
      // Already there.
    }
  }

  override async fetch(): Promise<Response> {
    if (this.ctx.getWebSockets().length >= MAX_MEMBERS * 2) {
      return new Response("This project has too many connections", { status: 503 });
    }
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ peer: randomToken(6), role: "guest" } satisfies Seat);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const seat = seatOf(ws);
    if (typeof message !== "string") {
      if (seat.role !== "guest" && message.byteLength <= MAX_MESSAGE_BYTES) {
        this.onData(ws, seat, new Uint8Array(message));
      }
      return;
    }

    let control: Control;
    try {
      control = JSON.parse(message) as Control;
    } catch {
      ws.close(1003, "Unreadable message");
      return;
    }

    const member = seat.role !== "guest";
    const owner = seat.role === "owner";
    switch (control.t) {
      case "owner":
        return this.signInOwner(ws, seat, control);
      case "member":
        return this.signInMember(ws, seat, control.token, control.peek === true);
      case "hello":
        return this.knock(ws, seat, control.hello);
      case "pull":
        if (member) this.pull(ws, control.after);
        return;
      case "media-get":
        if (member && Array.isArray(control.names)) this.getMedia(ws, seat, control.names);
        return;
      case "media-ack":
        if (member && Array.isArray(control.names)) this.ackMedia(seat, control.names);
        return;
      case "usage":
        if (member) this.sendUsage(ws);
        return;
      case "admit":
      case "deny":
        if (owner) await this.decide(control.t, control.peer);
        return;
      case "revoke":
        if (owner) this.revoke(control.member);
        return;
      case "invites":
        if (owner) {
          this.setMeta("invites", control.open === false ? "closed" : "open");
          send(ws, JSON.stringify({ t: "invites", open: control.open !== false }));
        }
        return;
      case "delete-project":
        if (owner) await this.deleteProject();
        return;
      default:
        ws.close(1003, "Unknown message");
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    const seat = seatOf(ws);
    // The runtime has usually answered the close already; closing twice throws.
    try {
      ws.close();
    } catch {
      // Already closed.
    }
    // Guests (knocks, start-screen peeks) were never in the member list.
    if (seat.role === "guest") return;
    this.broadcast({ t: "left", peer: seat.peer }, ws);
    this.sendMembers();
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  override async alarm(): Promise<void> {
    if (this.ctx.getWebSockets().length === 0) await this.deleteProject();
  }

  // ---------- who is who ----------

  /** The first owner connection creates the project; later ones must hold the same secret. */
  private async signInOwner(
    ws: WebSocket,
    seat: Seat,
    control: { secret: string; create?: boolean; peek?: boolean },
  ) {
    if (typeof control.secret !== "string" || !SECRET.test(control.secret)) {
      ws.close(4003, "Not the owner");
      return;
    }
    const hash = await sha256(control.secret);
    const stored = this.meta("owner");
    if (stored === null && control.create === true && control.peek !== true) {
      this.setMeta("owner", hash);
    } else if (stored === null) {
      this.goodbye(ws, "no-project", 4004);
      return;
    } else if (stored !== hash) {
      ws.close(4003, "Not the owner");
      return;
    }
    if (control.peek === true) {
      this.peek(ws);
      return;
    }
    this.enter(ws, { ...seat, role: "owner" });
    send(ws, JSON.stringify({ t: "invites", open: this.meta("invites") !== "closed" }));
    // Knocks that came while the owner was away.
    for (const other of this.ctx.getWebSockets()) {
      const waiting = seatOf(other);
      if (waiting.role === "guest" && waiting.hello !== undefined) {
        send(ws, JSON.stringify({ t: "knock", peer: waiting.peer, hello: waiting.hello }));
      }
    }
  }

  private async signInMember(ws: WebSocket, seat: Seat, token: string, peek: boolean) {
    if (typeof token !== "string" || !SECRET.test(token)) {
      ws.close(4003, "Not a member");
      return;
    }
    if (this.meta("owner") === null) {
      this.goodbye(ws, "no-project", 4004);
      return;
    }
    const row = this.sql
      .exec<{ member: string }>(
        "SELECT member FROM members WHERE token_hash = ?",
        await sha256(token),
      )
      .toArray()[0];
    if (row === undefined) {
      this.goodbye(ws, "removed", 4001);
      return;
    }
    if (peek) {
      this.peek(ws);
      return;
    }
    this.enter(ws, { ...seat, role: "member", member: row.member });
  }

  /**
   * Who is in the project right now, for a start screen, without joining: the asker never
   * becomes a seat, so nobody sees them come or go. Answers once and closes.
   */
  private peek(ws: WebSocket) {
    const seats = this.ctx.getWebSockets().map((other) => seatOf(other));
    const online = new Set(seats.map((seat) => seat.member).filter((m) => m !== undefined));
    const hellos = this.sql
      .exec<{ member: string; hello: string }>("SELECT member, hello FROM members ORDER BY created")
      .toArray()
      .filter((row) => online.has(row.member))
      .map((row) => row.hello);
    const owner = seats.some((seat) => seat.role === "owner");
    send(ws, JSON.stringify({ t: "online", owner, hellos }));
    ws.close(1000, "Peeked");
  }

  private enter(ws: WebSocket, seat: Seat) {
    ws.serializeAttachment(seat);
    send(
      ws,
      JSON.stringify({ t: "welcome", peer: seat.peer, role: seat.role, member: seat.member }),
    );
    this.broadcast({ t: "joined", peer: seat.peer }, ws);
    this.sendMembers();
    void this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
    this.dropOldMedia();
    // Files someone is waiting for: this member may have them.
    const wanted = this.sql
      .exec<{ name: string }>("SELECT DISTINCT name FROM media_wants WHERE who <> ?", tagOf(seat))
      .toArray()
      .map((row) => row.name);
    if (wanted.length > 0) send(ws, JSON.stringify({ t: "media-wanted", names: wanted }));
  }

  private async knock(ws: WebSocket, seat: Seat, hello: unknown) {
    if (this.meta("owner") === null) {
      this.goodbye(ws, "no-project", 4004);
      return;
    }
    if (this.meta("invites") === "closed") {
      this.goodbye(ws, "closed", 4006);
      return;
    }
    if (this.memberCount() >= MAX_MEMBERS) {
      this.goodbye(ws, "full", 4005);
      return;
    }
    if (typeof hello !== "string" || hello.length > MAX_HELLO_CHARS) {
      ws.close(1003, "Bad hello");
      return;
    }
    ws.serializeAttachment({ ...seat, hello } satisfies Seat);
    send(ws, JSON.stringify({ t: "waiting", peer: seat.peer }));
    const owner = this.ctx.getWebSockets().find((other) => seatOf(other).role === "owner");
    if (owner !== undefined) send(owner, JSON.stringify({ t: "knock", peer: seat.peer, hello }));
  }

  private async decide(action: "admit" | "deny", peer: string) {
    const target = this.ctx.getWebSockets().find((ws) => seatOf(ws).peer === peer);
    if (target === undefined) return;
    const seat = seatOf(target);
    if (seat.role !== "guest" || seat.hello === undefined) return;
    if (action === "deny") {
      this.goodbye(target, "denied", 4001);
      return;
    }
    const token = randomToken(32);
    const member = randomToken(9);
    this.sql.exec(
      "INSERT INTO members (member, token_hash, hello, created) VALUES (?, ?, ?, ?)",
      member,
      await sha256(token),
      seat.hello,
      Date.now(),
    );
    send(target, JSON.stringify({ t: "admitted", token }));
    this.enter(target, { peer: seat.peer, role: "member", member });
  }

  /** Removes a member for good; if they are connected, they are disconnected. */
  private revoke(member: unknown) {
    if (typeof member !== "string") return;
    this.sql.exec("DELETE FROM members WHERE member = ?", member);
    for (const ws of this.ctx.getWebSockets()) {
      if (seatOf(ws).member === member) this.goodbye(ws, "removed", 4001);
    }
    this.sendMembers();
  }

  /**
   * Every member with their sealed introduction and whether they are here, to everyone in the
   * project: names come from what the owner let in, not from what someone says later.
   */
  private sendMembers() {
    const online = new Set(
      this.ctx
        .getWebSockets()
        .map((ws) => seatOf(ws))
        .filter((seat) => seat.member !== undefined)
        .map((seat) => seat.member),
    );
    const list = this.sql
      .exec<{
        member: string;
        hello: string;
      }>("SELECT member, hello FROM members ORDER BY created")
      .toArray()
      .map((row) => ({ member: row.member, hello: row.hello, online: online.has(row.member) }));
    this.broadcast({ t: "members", list });
  }

  // ---------- data ----------

  private onData(ws: WebSocket, seat: Seat, data: Uint8Array) {
    switch (data[0]) {
      case UPDATE: {
        if (this.full(ws, data.length, "update")) return;
        const body = data.slice(1);
        this.sql.exec("INSERT INTO updates (data) VALUES (?)", body.buffer);
        const seq = this.sql.exec<{ seq: number }>("SELECT last_insert_rowid() AS seq").one().seq;
        send(ws, JSON.stringify({ t: "stored", seq }));
        this.relay(ws, numbered(seq, body));
        return;
      }
      case EPHEMERAL: {
        // Stamped with who sent it, as the relay knows them, so no one can pose as another.
        const sender = new TextEncoder().encode(
          seat.role === "owner" ? "owner" : (seat.member ?? ""),
        );
        const frame = new Uint8Array(2 + sender.length + data.length - 1);
        frame[0] = EPHEMERAL;
        frame[1] = sender.length;
        frame.set(sender, 2);
        frame.set(data.subarray(1), 2 + sender.length);
        this.relay(ws, frame);
        return;
      }
      case MEDIA: {
        const header = mediaHeader(data);
        if (header === null || this.full(ws, data.length, "media", header.name)) return;
        this.sql.exec(
          "INSERT OR REPLACE INTO media (name, part, parts, data, created) VALUES (?, ?, ?, ?, ?)",
          header.name,
          header.part,
          header.parts,
          data.slice(header.end).buffer,
          Date.now(),
        );
        if (this.partsHere(header.name) < header.parts) return;
        // Complete: the sender has it, and anyone waiting for it gets it now.
        this.sql.exec(
          "INSERT OR IGNORE INTO media_acks (name, who) VALUES (?, ?)",
          header.name,
          tagOf(seat),
        );
        const waiting = new Set(
          this.sql
            .exec<{ who: string }>("SELECT who FROM media_wants WHERE name = ?", header.name)
            .toArray()
            .map((row) => row.who),
        );
        for (const other of this.ctx.getWebSockets()) {
          if (other !== ws && waiting.has(tagOf(seatOf(other)))) this.sendFile(other, header.name);
        }
        this.dropIfDelivered(header.name);
        return;
      }
      case SNAPSHOT:
        // Replacing the history is the owner's alone: a member could otherwise wipe it.
        if (seat.role === "owner") this.storeSnapshotPart(data);
        return;
    }
  }

  /**
   * Collects a snapshot's pieces. Once all are here, they replace every stored edit up to
   * `upTo`, numbered just below it, and the range is remembered so a member who saw only part
   * of it gets all of it.
   */
  private storeSnapshotPart(data: Uint8Array) {
    if (data.length < 9) return;
    const view = new DataView(data.buffer, data.byteOffset + 1, 8);
    const upTo = view.getUint32(0);
    const part = view.getUint16(4);
    const parts = view.getUint16(6);
    const latest = this.sql
      .exec<{ seq: number | null }>("SELECT MAX(seq) AS seq FROM updates")
      .one().seq;
    if (latest === null || upTo > latest || parts === 0 || parts > upTo || part >= parts) return;
    this.sql.exec("DELETE FROM snapshot_parts WHERE up_to <> ?", upTo);
    this.sql.exec(
      "INSERT OR REPLACE INTO snapshot_parts (up_to, part, parts, data) VALUES (?, ?, ?, ?)",
      upTo,
      part,
      parts,
      data.slice(9).buffer,
    );
    const have = this.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM snapshot_parts WHERE up_to = ?", upTo)
      .one().n;
    if (have < parts) return;

    const from = upTo - parts + 1;
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM updates WHERE seq <= ?", upTo);
      for (const row of this.sql
        .exec<{ part: number; data: ArrayBuffer }>(
          "SELECT part, data FROM snapshot_parts WHERE up_to = ? ORDER BY part",
          upTo,
        )
        .toArray()) {
        this.sql.exec("INSERT INTO updates (seq, data) VALUES (?, ?)", from + row.part, row.data);
      }
      this.sql.exec("DELETE FROM snapshot_parts");
      this.setMeta("snapshot_from", String(from));
      this.setMeta("snapshot_to", String(upTo));
    });
  }

  /** Sends the stored edits after `after`, then says where it stopped. */
  private pull(ws: WebSocket, after: unknown) {
    let from = typeof after === "number" && Number.isInteger(after) && after >= 0 ? after : 0;
    // Partway into a snapshot: send the whole snapshot, it is only useful complete.
    const snapshotTo = Number(this.meta("snapshot_to") ?? 0);
    const snapshotFrom = Number(this.meta("snapshot_from") ?? 0);
    if (from < snapshotTo) from = Math.min(from, snapshotFrom - 1);
    let last = from;
    for (const row of this.sql.exec<{ seq: number; data: ArrayBuffer }>(
      "SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq",
      from,
    )) {
      send(ws, numbered(row.seq, new Uint8Array(row.data)));
      last = Math.max(last, row.seq);
    }
    send(ws, JSON.stringify({ t: "pulled", upTo: last }));
  }

  /**
   * Sends the files the relay holds. For the others it asks the members who are online, and
   * remembers the request, so a member coming online later is asked too.
   */
  private getMedia(ws: WebSocket, seat: Seat, names: unknown[]) {
    const missing: string[] = [];
    for (const name of names.slice(0, 500)) {
      if (typeof name !== "string" || !MEDIA_NAME.test(name)) continue;
      if (this.isComplete(name)) {
        this.sendFile(ws, name);
      } else {
        missing.push(name);
        this.sql.exec(
          "INSERT OR IGNORE INTO media_wants (name, who) VALUES (?, ?)",
          name,
          tagOf(seat),
        );
      }
    }
    if (missing.length === 0) return;
    const ask = JSON.stringify({ t: "media-wanted", names: missing });
    for (const other of this.ctx.getWebSockets()) {
      if (other !== ws && seatOf(other).role !== "guest") send(other, ask);
    }
  }

  /** A member has these files on their computer now. */
  private ackMedia(seat: Seat, names: unknown[]) {
    for (const name of names.slice(0, 500)) {
      if (typeof name !== "string" || !MEDIA_NAME.test(name)) continue;
      this.sql.exec(
        "INSERT OR IGNORE INTO media_acks (name, who) VALUES (?, ?)",
        name,
        tagOf(seat),
      );
      this.sql.exec("DELETE FROM media_wants WHERE name = ? AND who = ?", name, tagOf(seat));
      this.dropIfDelivered(name);
    }
  }

  /** Once every member, the owner included, has a file, the relay lets it go. */
  private dropIfDelivered(name: string) {
    const missing = this.sql
      .exec<{ n: number }>(
        "SELECT COUNT(*) AS n FROM (SELECT 'owner' AS who UNION SELECT member FROM members) " +
          "WHERE who NOT IN (SELECT who FROM media_acks WHERE name = ?)",
        name,
      )
      .one().n;
    if (missing > 0) return;
    this.sql.exec("DELETE FROM media WHERE name = ?", name);
    this.sql.exec("DELETE FROM media_acks WHERE name = ?", name);
    this.sql.exec("DELETE FROM media_wants WHERE name = ?", name);
  }

  /** Files nobody collected in two weeks; whoever sent them still has them. */
  private dropOldMedia() {
    const old = "SELECT name FROM media GROUP BY name HAVING MIN(created) < ?";
    const cutoff = Date.now() - MEDIA_MAX_AGE_MS;
    this.sql.exec("DELETE FROM media_acks WHERE name IN (" + old + ")", cutoff);
    this.sql.exec("DELETE FROM media WHERE name IN (" + old + ")", cutoff);
  }

  private partsHere(name: string): number {
    return this.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM media WHERE name = ?", name)
      .one().n;
  }

  private isComplete(name: string): boolean {
    const row = this.sql
      .exec<{ have: number; parts: number | null }>(
        "SELECT COUNT(*) AS have, MAX(parts) AS parts FROM media WHERE name = ?",
        name,
      )
      .one();
    return row.parts !== null && row.have >= row.parts;
  }

  private sendFile(ws: WebSocket, name: string) {
    for (const row of this.sql
      .exec<{
        part: number;
        parts: number;
        data: ArrayBuffer;
      }>("SELECT part, parts, data FROM media WHERE name = ? ORDER BY part", name)
      .toArray()) {
      send(ws, mediaFrame(name, row.part, row.parts, new Uint8Array(row.data)));
    }
  }

  /** How much the project holds: the story's text, and files still on their way. */
  private sendUsage(ws: WebSocket) {
    const bytes = (table: "updates" | "media") =>
      this.sql
        .exec<{ bytes: number }>("SELECT IFNULL(SUM(LENGTH(data)), 0) AS bytes FROM " + table)
        .one().bytes;
    send(
      ws,
      JSON.stringify({
        t: "usage",
        text: bytes("updates"),
        files: bytes("media"),
        limit: this.limit(),
      }),
    );
  }

  /** Closes everyone's connection and forgets the project, its edits and its members. */
  private async deleteProject() {
    for (const ws of this.ctx.getWebSockets()) this.goodbye(ws, "deleted", 4002);
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.createTables();
  }

  // ---------- helpers ----------

  private limit(): number {
    return Number(this.env.PROJECT_LIMIT_BYTES) || MAX_PROJECT_BYTES;
  }

  /**
   * Refuses more data once the project holds its share, and tells the sender exactly what was
   * refused, so it keeps that and sends it again once there is room.
   */
  private full(ws: WebSocket, adding: number, kind: "update" | "media", name?: string): boolean {
    const used = this.sql
      .exec<{ bytes: number }>(
        `SELECT (SELECT IFNULL(SUM(LENGTH(data)), 0) FROM media)
              + (SELECT IFNULL(SUM(LENGTH(data)), 0) FROM updates) AS bytes`,
      )
      .one().bytes;
    if (used + adding <= this.limit()) return false;
    send(ws, JSON.stringify({ t: "storage-full", kind, name }));
    return true;
  }

  private meta(key: string): string | null {
    return (
      this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key).toArray()[0]
        ?.value ?? null
    );
  }

  private setMeta(key: string, value: string) {
    this.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", key, value);
  }

  private memberCount(): number {
    return this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM members").one().n;
  }

  private relay(from: WebSocket, data: Uint8Array) {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== from && seatOf(ws).role !== "guest") send(ws, data);
    }
  }

  private broadcast(message: object, except?: WebSocket) {
    const text = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== except && seatOf(ws).role !== "guest") send(ws, text);
    }
  }

  private goodbye(ws: WebSocket, reason: string, code: number) {
    send(ws, JSON.stringify({ t: reason }));
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
  }
}

function numbered(seq: number, body: Uint8Array): Uint8Array {
  const frame = new Uint8Array(5 + body.length);
  frame[0] = UPDATE;
  new DataView(frame.buffer).setUint32(1, seq);
  frame.set(body, 5);
  return frame;
}

function mediaHeader(
  data: Uint8Array,
): { name: string; part: number; parts: number; end: number } | null {
  const length = data[1] ?? 0;
  if (data.length < 2 + length + 4) return null;
  const name = new TextDecoder().decode(data.subarray(2, 2 + length));
  const view = new DataView(data.buffer, data.byteOffset + 2 + length, 4);
  const part = view.getUint16(0);
  const parts = view.getUint16(2);
  if (!MEDIA_NAME.test(name) || parts === 0 || parts > 200 || part >= parts) return null;
  return { name, part, parts, end: 2 + length + 4 };
}

function mediaFrame(name: string, part: number, parts: number, body: Uint8Array): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const frame = new Uint8Array(2 + nameBytes.length + 4 + body.length);
  frame[0] = MEDIA;
  frame[1] = nameBytes.length;
  frame.set(nameBytes, 2);
  const view = new DataView(frame.buffer, 2 + nameBytes.length, 4);
  view.setUint16(0, part);
  view.setUint16(2, parts);
  frame.set(body, 2 + nameBytes.length + 4);
  return frame;
}

/** A socket closing at this moment must not stop the message reaching everyone else. */
function send(ws: WebSocket, message: string | Uint8Array): void {
  try {
    ws.send(message);
  } catch {
    // Closing; its close handler tells the others.
  }
}

/** "owner" or the member id: who has which file. */
function tagOf(seat: Seat): string {
  return seat.role === "owner" ? "owner" : (seat.member ?? seat.peer);
}

function seatOf(ws: WebSocket): Seat {
  return ws.deserializeAttachment() as Seat;
}

function randomToken(bytes: number): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
