/**
 * Sound effects, soundboard style: every hit starts the effect again from the beginning,
 * cutting off the previous hit of the same effect, so it can be hammered as fast as a finger
 * goes and is always heard once, never piled on itself. Different effects can sound together.
 *
 * Effects are decoded once into memory and played through Web Audio, which starts a sound in
 * a few milliseconds and mixes any number of them. They have their own audio context, apart
 * from the music player's element, so hitting effects never stops, pauses or stutters the
 * music. A cap on voices keeps many pads at once from piling up: the oldest stops to make room.
 */

import { DEFAULT_SFX_VOLUME } from "@core/model";
import { readUpTo } from "./media-read";
import { createStore } from "./store/create-store";
import type { DocumentStore } from "./store/document-store";

const MAX_VOICES = 24;
/** Effects are short; a file this large plays from an element instead of decoding. */
const MAX_DECODED_BYTES = 25 * 1024 * 1024;
/** Decoded effects kept ready in memory; the longest unused make room, and decode again if hit. */
const MAX_READY_BYTES = 512 * 1024 * 1024;

let context: AudioContext | null = null;
let output: GainNode | null = null;
const decoded = new Map<string, Promise<AudioBuffer | null>>();
const readyBytes = new Map<string, number>();
/** `own` is the effect's own level as a gain; `apply` puts levels into effect while it sounds. */
const voices: { url: string; own: number; stop: () => void; apply: () => void }[] = [];

/** The volume from 0 to 1 that the open story asks for. Music is not affected. */
export const sfxVolume = createStore({ level: DEFAULT_SFX_VOLUME });

/** Squared, because hearing is not linear: the slider's middle then sounds like the middle. */
const gainOf = (level: number) => level * level;

function setSfxVolume(level: number): void {
  if (level === sfxVolume.getState().level) return;
  sfxVolume.setState({ level });
  if (output !== null) output.gain.value = gainOf(level);
  for (const voice of voices) voice.apply();
}

/** Keeps the volume on what the open story says. Returns a function that stops doing so. */
export function followStoryVolume(document: DocumentStore): () => void {
  return document.subscribe((state) => {
    setSfxVolume(state.story?.settings?.sfxVolume ?? DEFAULT_SFX_VOLUME);
  });
}

/**
 * The effects sounding right now and when each hit started, so a pad can show that it plays,
 * how far along it is, and offer to stop it.
 */
export const sfxPlaying = createStore<{ hits: Readonly<Record<string, number>> }>({ hits: {} });

function publish(): void {
  const hits: Record<string, number> = {};
  for (const voice of voices) hits[voice.url] = sfxPlaying.getState().hits[voice.url] ?? 0;
  sfxPlaying.setState({ hits });
}

function started(url: string): void {
  sfxPlaying.setState((state) => ({ hits: { ...state.hits, [url]: performance.now() } }));
}

/** How long an effect lasts in seconds, once decoded; 0 when not known. */
export function sfxLength(url: string): number {
  return lengths.get(url) ?? 0;
}
const lengths = new Map<string, number>();

function audioContext(): { context: AudioContext; output: GainNode } | null {
  if (typeof AudioContext === "undefined") return null;
  if (context === null || output === null) {
    context = new AudioContext({ latencyHint: "interactive" });
    output = context.createGain();
    output.gain.value = gainOf(sfxVolume.getState().level);
    output.connect(context.destination);
  }
  return { context, output };
}

/** Decodes an effect ahead of its first hit, so even that one starts at once. */
export function preloadSfx(url: string): Promise<AudioBuffer | null> {
  const known = decoded.get(url);
  if (known !== undefined) {
    // Moved to the back: the map's front is what was used longest ago.
    decoded.delete(url);
    decoded.set(url, known);
    return known;
  }
  const job = (async () => {
    const audio = audioContext();
    if (audio === null || url === "") return null;
    const bytes = await readUpTo(url, MAX_DECODED_BYTES);
    if (bytes === null) return null;
    const buffer = await audio.context.decodeAudioData(bytes.buffer as ArrayBuffer);
    lengths.set(url, buffer.duration);
    readyBytes.set(url, buffer.length * buffer.numberOfChannels * 4);
    makeRoom(url);
    return buffer;
  })().catch(() => null);
  decoded.set(url, job);
  // Not ready is not final: a sound still on its way from a friend can be tried again.
  void job.then((buffer) => {
    if (buffer === null) decoded.delete(url);
  });
  return job;
}

function makeRoom(newest: string): void {
  let total = 0;
  for (const bytes of readyBytes.values()) total += bytes;
  for (const url of decoded.keys()) {
    if (total <= MAX_READY_BYTES) return;
    // A sound that is playing keeps its own memory until it ends; dropping it here is safe.
    if (url === newest) continue;
    total -= readyBytes.get(url) ?? 0;
    readyBytes.delete(url);
    decoded.delete(url);
  }
}

/** Plays an effect from the start, cutting off its previous hit if that is still sounding. */
export async function playSfx(url: string, volume = 1): Promise<void> {
  const audio = audioContext();
  if (audio === null) return;
  // Browsers start audio contexts suspended until a person interacts; a hit is that.
  if (audio.context.state === "suspended") await audio.context.resume();
  const buffer = await preloadSfx(url);
  // Stopped after the decode wait, so the newest hit always wins even when two race.
  for (const voice of voices.filter((v) => v.url === url)) voice.stop();
  if (voices.length >= MAX_VOICES) voices.shift()?.stop();

  if (buffer === null) {
    // Too large or not decodable here: an element plays it, restarting the same way.
    const element = new Audio(url);
    const voice = {
      url,
      own: gainOf(volume),
      // shortcut: an element cannot play louder than its file, so levels above 100% stop at the
      // file's level here; only files over 25 MB play this way.
      apply: () => {
        element.volume = Math.min(1, gainOf(sfxVolume.getState().level) * voice.own);
      },
      stop: () => {
        element.pause();
        forget(voice);
      },
    };
    voice.apply();
    voices.push(voice);
    started(url);
    element.addEventListener("loadedmetadata", () => lengths.set(url, element.duration), {
      once: true,
    });
    element.addEventListener("ended", () => forget(voice), { once: true });
    await element.play().catch(() => forget(voice));
    return;
  }
  const source = audio.context.createBufferSource();
  source.buffer = buffer;
  const own = audio.context.createGain();
  source.connect(own);
  own.connect(audio.output);
  const voice = {
    url,
    own: gainOf(volume),
    apply: () => {
      own.gain.value = voice.own;
    },
    stop: () => {
      forget(voice);
      try {
        source.stop();
      } catch {
        // Already finished.
      }
    },
  };
  voice.apply();
  voices.push(voice);
  started(url);
  source.addEventListener("ended", () => forget(voice), { once: true });
  source.start();
}

/** Changes an effect's own level, also while it sounds. */
export function setSfxOwnVolume(url: string, volume: number): void {
  for (const voice of voices.filter((v) => v.url === url)) {
    voice.own = gainOf(volume);
    voice.apply();
  }
}

/** Stops one effect if it is sounding; the music and other effects carry on. */
export function stopSfx(url: string): void {
  for (const voice of voices.filter((v) => v.url === url)) voice.stop();
}

/** Silences every effect at once, e.g. a panic button; the music is not touched. */
export function stopAllSfx(): void {
  for (const voice of voices.splice(0)) voice.stop();
  publish();
}

/** How many effects are sounding right now. */
export function sfxVoices(): number {
  return voices.length;
}

function forget(voice: (typeof voices)[number]): void {
  const at = voices.indexOf(voice);
  if (at !== -1) voices.splice(at, 1);
  publish();
}
