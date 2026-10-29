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

import { createStore } from "./store/create-store";

const MAX_VOICES = 24;
/** Effects are short; a file this large plays from an element instead of decoding. */
const MAX_DECODED_BYTES = 25 * 1024 * 1024;

let context: AudioContext | null = null;
let output: GainNode | null = null;
const decoded = new Map<string, Promise<AudioBuffer | null>>();
const voices: { url: string; stop: () => void }[] = [];

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
    output.connect(context.destination);
  }
  return { context, output };
}

/** Decodes an effect ahead of its first hit, so even that one starts at once. */
export function preloadSfx(url: string): Promise<AudioBuffer | null> {
  const known = decoded.get(url);
  if (known !== undefined) return known;
  const job = (async () => {
    const audio = audioContext();
    if (audio === null || url === "") return null;
    const response = await fetch(url);
    if (!response.ok) return null;
    const size = Number(response.headers.get("content-length") ?? 0);
    if (size > MAX_DECODED_BYTES) return null;
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_DECODED_BYTES) return null;
    const buffer = await audio.context.decodeAudioData(bytes);
    lengths.set(url, buffer.duration);
    return buffer;
  })().catch(() => null);
  decoded.set(url, job);
  return job;
}

/** Plays an effect from the start, cutting off its previous hit if that is still sounding. */
export async function playSfx(url: string): Promise<void> {
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
      stop: () => {
        element.pause();
        forget(voice);
      },
    };
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
  source.connect(audio.output);
  const voice = {
    url,
    stop: () => {
      forget(voice);
      try {
        source.stop();
      } catch {
        // Already finished.
      }
    },
  };
  voices.push(voice);
  started(url);
  source.addEventListener("ended", () => forget(voice), { once: true });
  source.start();
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

function forget(voice: { url: string; stop: () => void }): void {
  const at = voices.indexOf(voice);
  if (at !== -1) voices.splice(at, 1);
  publish();
}
