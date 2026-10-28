// What the relay does when a project's space is used up. Run against a relay with a tiny limit:
//   pnpm dev --var PROJECT_LIMIT_BYTES:4000
//   node scripts/full.mjs
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";

const BASE = (process.env.SAMPO_LIVE_URL ?? "ws://127.0.0.1:8787").replace(/^http/u, "ws");
const room = randomBytes(16).toString("base64url");

const ws = new WebSocket(`${BASE}/session/${room}`);
const inbox = [];
const waiters = [];
ws.addEventListener("message", ({ data }) => {
  if (typeof data !== "string") return;
  const message = JSON.parse(data);
  if (waiters.length > 0) waiters.shift()(message);
  else inbox.push(message);
});
await new Promise((resolve) => ws.addEventListener("open", resolve));
const next = async (t) => {
  for (;;) {
    const message =
      inbox.shift() ??
      (await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no ${t}`)), 3000);
        waiters.push((m) => {
          clearTimeout(timer);
          resolve(m);
        });
      }));
    if (message.t === t) return message;
  }
};

ws.send(
  JSON.stringify({ t: "owner", secret: randomBytes(32).toString("base64url"), create: true }),
);
await next("welcome");

// Room for this edit; not for the next one, and the sender is told it was the edit.
ws.send(new Uint8Array([1, ...randomBytes(3000)]));
await next("stored");
ws.send(new Uint8Array([1, ...randomBytes(2000)]));
assert.deepEqual(await next("storage-full"), { t: "storage-full", kind: "update" });

// A picture that does not fit is named, so the app knows which one to send again.
const name = createHash("sha256").update("big sound").digest("hex");
const nameBytes = new TextEncoder().encode(name);
ws.send(new Uint8Array([3, nameBytes.length, ...nameBytes, 0, 0, 0, 1, ...randomBytes(2000)]));
assert.deepEqual(await next("storage-full"), { t: "storage-full", kind: "media", name });

ws.send(JSON.stringify({ t: "usage" }));
assert.equal((await next("usage")).limit, 4000);

ws.send(JSON.stringify({ t: "delete-project" }));
await next("deleted");
console.log("Full-space test passed");
