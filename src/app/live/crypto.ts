/**
 * End-to-end encryption for live sessions. The session code holds the room's address and its
 * key; the key never goes to the relay, which only ever sees ciphertext. AES-256-GCM, so a
 * message changed on the way, or sealed with another key, fails to open.
 */

const PREFIX = "SAMPO-";
const ROOM_BYTES = 16;
const KEY_BYTES = 32;
const IV_BYTES = 12;

export interface SessionSecrets {
  /** Public address of the room on the relay. */
  readonly roomId: string;
  /** Never leaves the participants' computers. */
  readonly key: Uint8Array;
}

export function newSecrets(): SessionSecrets {
  return { roomId: base64url(random(ROOM_BYTES)), key: random(KEY_BYTES) };
}

/** A random secret that proves to the relay who started the room. */
export function newHostSecret(): string {
  return base64url(random(32));
}

/** The code the host sends to friends, e.g. over Discord. */
export function formatCode({ roomId, key }: SessionSecrets): string {
  return `${PREFIX}${roomId}.${base64url(key)}`;
}

/** Reads a pasted code; `null` when it is not one. Spaces and line breaks are ignored. */
export function parseCode(text: string): SessionSecrets | null {
  const match = /^SAMPO-([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/u.exec(text.replace(/\s/gu, ""));
  if (match?.[1] === undefined || match[2] === undefined) return null;
  const key = fromBase64url(match[2]);
  return key.length === KEY_BYTES ? { roomId: match[1], key } : null;
}

export interface ProjectKeys {
  /** Encrypts everything sent: edits, presence, pictures. */
  readonly seal: CryptoKey;
  /** Names pictures on the relay without revealing which picture it is. */
  readonly name: CryptoKey;
}

/** Separate keys for separate jobs, derived from the project key (HKDF-SHA-256). */
export async function projectKeys(key: Uint8Array): Promise<ProjectKeys> {
  const base = await crypto.subtle.importKey("raw", key as BufferSource, "HKDF", false, [
    "deriveKey",
  ]);
  const derive = (info: string, algorithm: AesKeyGenParams | HmacKeyGenParams, uses: KeyUsage[]) =>
    crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(),
        info: new TextEncoder().encode(info),
      },
      base,
      algorithm,
      false,
      uses,
    );
  return {
    seal: await derive("sampo/seal", { name: "AES-GCM", length: 256 }, ["encrypt", "decrypt"]),
    name: await derive("sampo/media-name", { name: "HMAC", hash: "SHA-256", length: 256 }, [
      "sign",
    ]),
  };
}

/** The relay's name for a picture: a keyed hash, so the relay cannot tell which file it is. */
export async function mediaName(keys: ProjectKeys, mediaId: string): Promise<string> {
  const mac = await crypto.subtle.sign("HMAC", keys.name, new TextEncoder().encode(mediaId));
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Encrypts with a fresh random IV, sent in front of the ciphertext. */
export async function seal(key: CryptoKey, plain: Uint8Array): Promise<Uint8Array> {
  const iv = random(IV_BYTES);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      plain as BufferSource,
    ),
  );
  const out = new Uint8Array(IV_BYTES + sealed.length);
  out.set(iv);
  out.set(sealed, IV_BYTES);
  return out;
}

/** `null` when the message was changed or sealed with another key. */
export async function open(key: CryptoKey, data: Uint8Array): Promise<Uint8Array | null> {
  if (data.length <= IV_BYTES) return null;
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: data.slice(0, IV_BYTES) as BufferSource },
        key,
        data.slice(IV_BYTES) as BufferSource,
      ),
    );
  } catch {
    return null;
  }
}

function random(bytes: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(bytes));
}

export function base64url(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function fromBase64url(text: string): Uint8Array {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
