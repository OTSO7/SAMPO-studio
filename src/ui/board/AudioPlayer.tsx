import { useEffect, useRef, useState, type PointerEvent } from "react";

interface AudioPlayerProps {
  /** Where the window loads the sound from. */
  url: string;
  /** What the sound is, for screen readers and the tooltip. */
  label: string;
  /** Just the play button and time, for a line's take inside a row. */
  compact?: boolean;
}

/** Only one sound plays at a time, as on a mixing desk's solo button. */
let playing: HTMLAudioElement | null = null;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** A small player in the app's own style: play, a progress bar to scrub, and the time. */
export function AudioPlayer({ url, label, compact = false }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Stop when the player leaves the screen, e.g. the card panel closes.
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      audio?.pause();
      if (playing === audio) playing = null;
    };
  }, []);

  const toggle = () => {
    const audio = audioRef.current;
    if (audio === null) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    if (playing !== null && playing !== audio) playing.pause();
    playing = audio;
    void audio.play();
  };

  const seek = (event: PointerEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (audio === null || duration === 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    audio.currentTime = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) * duration;
  };

  const progress = duration === 0 ? 0 : (time / duration) * 100;

  return (
    <div className={`player ${compact ? "player--compact" : ""} ${isPlaying ? "is-playing" : ""}`}>
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onPlay={() => {
          setIsPlaying(true);
        }}
        onPause={() => {
          setIsPlaying(false);
        }}
        onEnded={() => {
          setIsPlaying(false);
          setTime(0);
        }}
        onTimeUpdate={(event) => {
          setTime(event.currentTarget.currentTime);
        }}
        onLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration);
        }}
      />
      <button
        type="button"
        className="player__toggle"
        aria-label={`${isPlaying ? "Pause" : "Play"} ${label}`}
        title={label}
        onClick={toggle}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          {isPlaying ? <path d="M3 2h2v8H3zM7 2h2v8H7z" /> : <path d="M3 1.5v9l7.5-4.5z" />}
        </svg>
      </button>
      {!compact && (
        <div
          className="player__track"
          role="slider"
          aria-label={`Position in ${label}`}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          tabIndex={0}
          onPointerDown={seek}
          onKeyDown={(event) => {
            const audio = audioRef.current;
            if (audio === null) return;
            if (event.key === "ArrowRight") audio.currentTime = Math.min(duration, time + 5);
            if (event.key === "ArrowLeft") audio.currentTime = Math.max(0, time - 5);
          }}
        >
          <span className="player__fill" style={{ width: `${progress}%` }} />
        </div>
      )}
      <span className="player__time">
        {isPlaying || time > 0 ? formatTime(time) : formatTime(duration)}
      </span>
    </div>
  );
}
