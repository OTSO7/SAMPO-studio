import { createStore } from "./store/create-store";

/**
 * The one sound playing in the whole app. It lives here rather than in a player on the
 * screen, so a song keeps going when the page, the card panel or the view changes; only the
 * person stops it. The file plays as stored: a WAV goes to the speakers as the original
 * samples, nothing is re-encoded on the way.
 */
export interface PlaybackState {
  readonly url: string | null;
  readonly label: string;
  readonly playing: boolean;
  readonly time: number;
  readonly duration: number;
  /** Set when the file cannot be played, e.g. it is missing or not a sound. */
  readonly error: string | null;
}

export const playback = createStore<PlaybackState>({
  url: null,
  label: "",
  playing: false,
  time: 0,
  duration: 0,
  error: null,
});

let element: HTMLAudioElement | null = null;

function audio(): HTMLAudioElement {
  if (element !== null) return element;
  const created = new Audio();
  created.preload = "auto";
  const sync = () => {
    playback.setState({
      playing: !created.paused && !created.ended,
      time: created.currentTime,
      duration: Number.isFinite(created.duration) ? created.duration : 0,
    });
  };
  for (const name of ["play", "pause", "ended", "timeupdate", "loadedmetadata", "seeked"]) {
    created.addEventListener(name, sync);
  }
  // A hiccup mid-song (the disk busy, the decoder tripping) gets one quiet retry from the
  // same spot before the person is told; most never reach their ears.
  let retried = "";
  created.addEventListener("error", () => {
    const { url, time } = playback.getState();
    if (url !== null && retried !== url) {
      retried = url;
      created.src = url;
      created.addEventListener(
        "loadedmetadata",
        () => {
          created.currentTime = time;
        },
        { once: true },
      );
      created.play().catch(() => {
        playback.setState({ playing: false, error: "This sound could not be played." });
      });
      return;
    }
    playback.setState({ playing: false, error: "This sound could not be played." });
  });
  created.addEventListener("playing", () => {
    retried = "";
  });
  element = created;
  return created;
}

/** True while a sound is playing; saves and backups wait so the disk stays quiet for it. */
export const isPlaying = (): boolean => playback.getState().playing;

/** Plays `url`, or pauses and resumes it when it is the sound already loaded. */
export function togglePlay(url: string, label: string): void {
  const player = audio();
  if (playback.getState().url !== url) {
    player.src = url;
    playback.setState({ url, label, time: 0, duration: 0, error: null });
  } else if (!player.paused) {
    player.pause();
    return;
  }
  player.play().catch(() => {
    playback.setState({ playing: false, error: "This sound could not be played." });
  });
}

export function seek(seconds: number): void {
  const player = audio();
  player.currentTime = Math.max(0, Math.min(seconds, player.duration || 0));
}

/**
 * Jumps to a point given as a share of the track (0 to 1), e.g. where the waveform was pressed.
 * A track that is not loaded yet starts there.
 */
export function seekTo(url: string, label: string, share: number): void {
  const player = audio();
  const at = Math.min(1, Math.max(0, share));
  if (playback.getState().url === url && player.duration > 0) {
    player.currentTime = at * player.duration;
    return;
  }
  togglePlay(url, label);
  player.addEventListener(
    "loadedmetadata",
    () => {
      player.currentTime = at * (player.duration || 0);
    },
    { once: true },
  );
}

/** Where the loaded track is right now, finer than the store's few updates a second. */
export function currentTime(): number {
  return element?.currentTime ?? 0;
}

/** Back to the start; keeps playing if it was. */
export function restart(): void {
  seek(0);
}

export function stop(): void {
  const player = audio();
  player.pause();
  player.removeAttribute("src");
  player.load();
  playback.setState({ url: null, label: "", playing: false, time: 0, duration: 0, error: null });
}

/** 83.4 seconds as "1:23". */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
