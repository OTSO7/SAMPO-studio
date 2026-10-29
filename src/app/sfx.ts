/**
 * Sound effects, soundboard style: every hit plays at once, on top of the hits before it,
 * so an effect can be hammered as fast as a finger goes.
 *
 * Effects are decoded once into memory and played through Web Audio, which starts a sound in
 * a few milliseconds and mixes any number of them. They have their own audio context, apart
 * from the music player's element, so hitting effects never stops, pauses or stutters the
 * music. A cap on voices keeps a stuck key from piling up hundreds of sounds: the oldest stops
 * to make room.
 */

const MAX_VOICES = 24;
/** Effects are short; a file this large is played without decoding, still overlapping. */
const MAX_DECODED_BYTES = 25 * 1024 * 1024;

let context: AudioContext | null = null;
let output: GainNode | null = null;
const decoded = new Map<string, Promise<AudioBuffer | null>>();
const voices: { stop: () => void }[] = [];

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
    return audio.context.decodeAudioData(bytes);
  })().catch(() => null);
  decoded.set(url, job);
  return job;
}

/** Plays an effect once more, over anything already sounding. */
export async function playSfx(url: string): Promise<void> {
  const audio = audioContext();
  if (audio === null) return;
  // Browsers start audio contexts suspended until a person interacts; a hit is that.
  if (audio.context.state === "suspended") await audio.context.resume();
  const buffer = await preloadSfx(url);
  if (voices.length >= MAX_VOICES) voices.shift()?.stop();

  if (buffer === null) {
    // Too large or not decodable here: an element of its own per hit still overlaps.
    const element = new Audio(url);
    const voice = { stop: () => element.pause() };
    voices.push(voice);
    element.addEventListener("ended", () => forget(voice), { once: true });
    await element.play().catch(() => forget(voice));
    return;
  }
  const source = audio.context.createBufferSource();
  source.buffer = buffer;
  source.connect(audio.output);
  const voice = {
    stop: () => {
      try {
        source.stop();
      } catch {
        // Already finished.
      }
    },
  };
  voices.push(voice);
  source.addEventListener("ended", () => forget(voice), { once: true });
  source.start();
}

/** Silences every effect at once, e.g. a panic button; the music is not touched. */
export function stopAllSfx(): void {
  for (const voice of voices.splice(0)) voice.stop();
}

/** How many effects are sounding right now. */
export function sfxVoices(): number {
  return voices.length;
}

function forget(voice: { stop: () => void }): void {
  const at = voices.indexOf(voice);
  if (at !== -1) voices.splice(at, 1);
}
