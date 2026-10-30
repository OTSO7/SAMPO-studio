import { useState } from "react";

import { formatTime, playback } from "@app/playback";
import { useStore } from "@ui/hooks/use-store";
import { keepKeysHere, usePlayerActions } from "./use-player-actions";
import { Waveform } from "./Waveform";

interface AudioPlayerProps {
  /** Where the window loads the sound from. */
  url: string;
  /** What the sound is, for screen readers and the tooltip. */
  label: string;
  /** Just the play button and time, for a line's take inside a row. */
  compact?: boolean;
}

/**
 * A small player in the app's own style: play, back to the start, the waveform to press or
 * drag through, the time.
 * It drives the app's one shared player, so the sound goes on when this leaves the screen
 * and only one sound plays at a time, as on a mixing desk's solo button.
 */
export function AudioPlayer({ url, label, compact = false }: AudioPlayerProps) {
  const actions = usePlayerActions();
  const state = useStore(playback, (s) => (s.url === url ? s : null));
  // Read from the file's header alone, so the length shows before anything plays.
  const [length, setLength] = useState(0);
  const playing = state?.playing === true;
  const time = state?.time ?? 0;
  const duration = state !== null && state.duration > 0 ? state.duration : length;

  return (
    <div
      className={`player ${compact ? "player--compact" : ""} ${playing ? "is-playing" : ""}`}
      onKeyDown={keepKeysHere}
    >
      <audio
        src={url}
        preload="metadata"
        onLoadedMetadata={(event) => {
          setLength(event.currentTarget.duration);
        }}
      />
      <button
        type="button"
        className="player__toggle"
        aria-label={`${playing ? "Pause" : "Play"} ${label}`}
        title={label}
        onClick={() => {
          actions.play(url, label);
        }}
      >
        <PlayIcon playing={playing} />
      </button>
      {!compact && (
        <button
          type="button"
          className="player__toggle player__restart"
          aria-label={`Back to the start of ${label}`}
          title="Back to the start"
          disabled={state === null}
          onClick={actions.restart}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 2h1.6v8H2zM10.5 2v8L4.5 6z" />
          </svg>
        </button>
      )}
      {!compact && <Waveform url={url} label={label} length={length} />}
      <span className="player__time">
        {state?.error ??
          (state !== null ? `${formatTime(time)} / ${formatTime(duration)}` : formatTime(duration))}
      </span>
    </div>
  );
}

export function PlayIcon({ playing }: { playing: boolean }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      {playing ? <path d="M3 2h2v8H3zM7 2h2v8H7z" /> : <path d="M3 1.5v9l7.5-4.5z" />}
    </svg>
  );
}
