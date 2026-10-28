import { describe, expect, it } from "vitest";

import { formatCode, mediaName, newSecrets, open, parseCode, projectKeys, seal } from "./crypto";

const importKey = async (raw: Uint8Array) => (await projectKeys(raw)).seal;

describe("session code", () => {
  it("round-trips, ignoring spaces a chat app may add", () => {
    const secrets = newSecrets();
    const code = formatCode(secrets);
    const parsed = parseCode(` ${code.slice(0, 20)}\n${code.slice(20)} `);
    expect(parsed?.roomId).toBe(secrets.roomId);
    expect(parsed?.key).toEqual(secrets.key);
  });

  it("rejects anything else", () => {
    expect(parseCode("hello")).toBeNull();
    expect(parseCode(formatCode(newSecrets()).slice(0, -1))).toBeNull();
  });
});

describe("media names", () => {
  it("are the same for one project and differ between projects", async () => {
    const id = `${"a".repeat(64)}.png`;
    const secrets = newSecrets();
    const one = await mediaName(await projectKeys(secrets.key), id);
    expect(one).toMatch(/^[0-9a-f]{64}$/u);
    expect(await mediaName(await projectKeys(secrets.key), id)).toBe(one);
    expect(await mediaName(await projectKeys(newSecrets().key), id)).not.toBe(one);
  });
});

describe("seal and open", () => {
  const text = new TextEncoder().encode("Iris: Hei.");

  it("opens with the same key", async () => {
    const key = await importKey(newSecrets().key);
    expect(await open(key, await seal(key, text))).toEqual(text);
  });

  it("refuses another key and any changed byte", async () => {
    const key = await importKey(newSecrets().key);
    const sealed = await seal(key, text);
    expect(await open(await importKey(newSecrets().key), sealed)).toBeNull();
    const changed = sealed.slice();
    changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 1;
    expect(await open(key, changed)).toBeNull();
  });

  it("never repeats a ciphertext", async () => {
    const key = await importKey(newSecrets().key);
    expect(await seal(key, text)).not.toEqual(await seal(key, text));
  });
});
