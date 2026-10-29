// End-to-end check of the shared-project relay against `pnpm dev` (or SAMPO_LIVE_URL): who
// gets in, who receives what, editing while the owner is away, removal and deletion.
//   pnpm dev      # in one terminal
//   pnpm smoke    # in another
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";

const BASE = (process.env.SAMPO_LIVE_URL ?? "ws://127.0.0.1:8787").replace(/^http/u, "ws");
const id = () => randomBytes(16).toString("base64url");
const secret = () => randomBytes(32).toString("base64url");

/** A connection that queues what it receives, so tests can wait for the next message. */
async function connect(room) {
  const ws = new WebSocket(`${BASE}/session/${room}`);
  ws.binaryType = "arraybuffer";
  const inbox = [];
  const waiters = [];
  const deliver = (item) => (waiters.length > 0 ? waiters.shift()(item) : inbox.push(item));
  ws.addEventListener("message", ({ data }) =>
    deliver(typeof data === "string" ? JSON.parse(data) : new Uint8Array(data)),
  );
  ws.addEventListener("close", ({ code }) => deliver({ t: "closed", code }));
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });
  const next = (ms = 3000) =>
    inbox.length > 0
      ? Promise.resolve(inbox.shift())
      : new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("nothing arrived")), ms);
          waiters.push((item) => {
            clearTimeout(timer);
            resolve(item);
          });
        });
  /** The next message of a kind, skipping presence chatter like "joined"/"members". */
  const nextOf = async (t) => {
    for (;;) {
      const item = await next();
      if (item instanceof Uint8Array ? t === "data" : item.t === t) return item;
    }
  };
  const quiet = async (ms = 400) => {
    await new Promise((r) => setTimeout(r, ms));
    return !inbox.some((item) => item instanceof Uint8Array);
  };
  const send = (message) =>
    ws.send(message instanceof Uint8Array ? message : JSON.stringify(message));
  return { ws, next, nextOf, quiet, send };
}

const update = (...bytes) => new Uint8Array([1, ...bytes]);
const seqOf = (frame) => new DataView(frame.buffer).getUint32(1);
const bodyOf = (frame) => [...frame.slice(5)];

const room = id();
const ownerSecret = secret();

// A project exists only once its owner creates it.
const early = await connect(room);
early.send({ t: "hello", hello: "x" });
assert.equal((await early.next()).t, "no-project");

const owner = await connect(room);
owner.send({ t: "owner", secret: ownerSecret, create: true });
assert.equal((await owner.nextOf("welcome")).role, "owner");

// Someone else cannot take it over.
const impostor = await connect(room);
impostor.send({ t: "owner", secret: secret() });
assert.equal((await impostor.next()).code, 4003);

// A newcomer knocks; nothing reaches them, and nothing they send counts, until admitted.
const matias = await connect(room);
matias.send({ t: "hello", hello: "sealed-name" });
const waiting = await matias.nextOf("waiting");
const knock = await owner.nextOf("knock");
assert.equal(knock.hello, "sealed-name");
owner.send(update(7));
await owner.nextOf("stored");
assert.ok(await matias.quiet(), "not admitted, nothing received");
matias.send(update(9));
matias.send({ t: "pull", after: 0 });
assert.ok(await owner.quiet(), "not admitted, nothing sent");

owner.send({ t: "admit", peer: waiting.peer });
const { token } = await matias.nextOf("admitted");
assert.equal((await matias.nextOf("welcome")).role, "member");

// Edits are stored, numbered and passed on.
owner.send(update(1, 2));
const stored = await owner.nextOf("stored");
const received = await matias.nextOf("data");
assert.equal(seqOf(received), stored.seq);
assert.deepEqual(bodyOf(received), [1, 2]);

// The owner's computer goes off; the member keeps editing.
owner.ws.close();
matias.send(update(3));
await matias.nextOf("stored");
matias.ws.close();

// The owner comes back and catches up on what happened meanwhile.
const ownerBack = await connect(room);
ownerBack.send({ t: "owner", secret: ownerSecret });
await ownerBack.nextOf("welcome");
ownerBack.send({ t: "pull", after: stored.seq });
const caughtUp = await ownerBack.nextOf("data");
assert.deepEqual(bodyOf(caughtUp), [3]);
const pulled = await ownerBack.nextOf("pulled");
assert.equal(pulled.upTo, seqOf(caughtUp));

// The member comes back with their token, no new invite needed.
const matiasBack = await connect(room);
matiasBack.send({ t: "member", token });
const welcome = await matiasBack.nextOf("welcome");
assert.equal(welcome.role, "member");

// The start screen asks who is here without joining: an answer, then the relay hangs up.
const peeker = await connect(room);
peeker.send({ t: "owner", secret: ownerSecret, peek: true });
const online = await peeker.nextOf("online");
assert.equal(online.owner, true);
assert.equal(online.hellos.length, 1);
assert.equal((await peeker.nextOf("closed")).code, 1000);
const strangerPeek = await connect(room);
strangerPeek.send({ t: "member", token: secret(), peek: true });
assert.notEqual((await strangerPeek.next()).t, "online");

// A picture waits in the mailbox until every member has it, then the relay lets it go.
const file = (label, bytes) => {
  const name = createHash("sha256").update(label).digest("hex");
  const nameBytes = new TextEncoder().encode(name);
  return { name, frame: new Uint8Array([3, nameBytes.length, ...nameBytes, 0, 0, 0, 1, ...bytes]) };
};
const usage = async (who) => {
  who.send({ t: "usage" });
  return who.nextOf("usage");
};
const picture = file("picture", [42, 43]);
ownerBack.send(picture.frame);
await new Promise((r) => setTimeout(r, 300));
assert.ok((await usage(ownerBack)).files > 0, "waiting in the mailbox");
matiasBack.send({ t: "media-get", names: [picture.name] });
assert.deepEqual([...(await matiasBack.nextOf("data"))], [...picture.frame]);
matiasBack.send({ t: "media-ack", names: [picture.name] });
await new Promise((r) => setTimeout(r, 300));
const afterDelivery = await usage(ownerBack);
assert.equal(afterDelivery.files, 0, "everyone has it: gone from the relay");
assert.ok(afterDelivery.text > 0 && afterDelivery.limit > 0);

// A file the relay does not hold is asked from members online, and passed on when sent.
const sound = file("sound", [7]);
matiasBack.send({ t: "media-get", names: [sound.name] });
assert.deepEqual((await ownerBack.nextOf("media-wanted")).names, [sound.name]);
ownerBack.send(sound.frame);
assert.deepEqual([...(await matiasBack.nextOf("data"))], [...sound.frame]);

// Presence is stamped with who sent it, so no one can pose as someone else.
matiasBack.send(new Uint8Array([2, 77]));
const stamped = await ownerBack.nextOf("data");
const matiasId = welcome.member;
assert.deepEqual([...stamped], [2, matiasId.length, ...new TextEncoder().encode(matiasId), 77]);

// A member cannot replace the history; the owner can, in pieces.
const latest = pulled.upTo;
matiasBack.send(new Uint8Array([4, 0, 0, 0, latest, 0, 0, 0, 1, 66]));
await new Promise((r) => setTimeout(r, 300));
matiasBack.send({ t: "pull", after: 0 });
assert.notEqual(bodyOf(await matiasBack.nextOf("data"))[0], 66, "member snapshot ignored");
await matiasBack.nextOf("pulled");
ownerBack.send(new Uint8Array([4, 0, 0, 0, latest, 0, 0, 0, 2, 98]));
ownerBack.send(new Uint8Array([4, 0, 0, 0, latest, 0, 1, 0, 2, 99]));
await new Promise((r) => setTimeout(r, 300));
// Someone who saw only part of the replaced range gets the whole snapshot.
matiasBack.send({ t: "pull", after: latest - 1 });
const first = await matiasBack.nextOf("data");
const second = await matiasBack.nextOf("data");
assert.deepEqual(
  [seqOf(first), ...bodyOf(first), seqOf(second), ...bodyOf(second)],
  [latest - 1, 98, latest, 99],
);
assert.equal((await matiasBack.nextOf("pulled")).upTo, latest);

// Closed invites turn knocks away at the door.
ownerBack.send({ t: "invites", open: false });
assert.equal((await ownerBack.nextOf("invites")).open, false);
const lateComer = await connect(room);
lateComer.send({ t: "hello", hello: "x" });
assert.equal((await lateComer.next()).t, "closed");
ownerBack.send({ t: "invites", open: true });
await ownerBack.nextOf("invites");

// Removed members are disconnected and cannot come back.
ownerBack.send({ t: "revoke", member: matiasId });
assert.equal((await matiasBack.nextOf("removed")).t, "removed");
const again = await connect(room);
again.send({ t: "member", token });
assert.equal((await again.next()).t, "removed");

// Deleting the project ends it for everyone.
ownerBack.send({ t: "delete-project" });
assert.equal((await ownerBack.nextOf("deleted")).t, "deleted");
const after = await connect(room);
after.send({ t: "owner", secret: ownerSecret });
assert.equal((await after.next()).t, "no-project");

for (const c of [early, owner, impostor, matias, ownerBack, matiasBack, again, after, lateComer]) {
  c.ws.close();
}
console.log("Shared project relay smoke test passed");
