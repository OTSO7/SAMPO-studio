import { useEffect, useRef } from "react";

import { playSfx, preloadSfx, setSfxOwnVolume, sfxLength, sfxPlaying, stopSfx } from "@app/sfx";
import { useStore } from "@ui/hooks/use-store";

/**
 * A soundboard pad: press it and the effect plays, press again and it starts over from the
 * beginning, as often as you like, heard once each time. It fires on the press itself, not
 * the release, so it keeps time with a finger; Enter and Space hit it too.
 *
 * While it plays, a bar runs along the pad to show how far it has got, and a stop button
 * appears beside it; Escape on the pad stops it too. A long effect never has to play out.
 */
export function SfxPad({
  url,
  label,
  large = false,
  volume = 1,
}: {
  url: string;
  label: string;
  large?: boolean;
  /** This effect's own level; see `AudioBlock.volume`. */
  volume?: number;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const startedAt = useStore(sfxPlaying, (s) => s.hits[url]);
  const playing = startedAt !== undefined;
  const length = sfxLength(url);

  // Decoded before the first hit, so that one is instant too.
  useEffect(() => {
    void preloadSfx(url);
  }, [url]);

  useEffect(() => {
    setSfxOwnVolume(url, volume);
  }, [url, volume]);

  const hit = () => {
    void playSfx(url, volume);
    // A flash per hit, run by the compositor; restarting it costs nothing.
    ref.current?.animate(
      [
        { transform: "scale(0.97)", filter: "brightness(1.5)" },
        { transform: "none", filter: "none" },
      ],
      { duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
  };

  return (
    <div className={`pad-wrap ${playing ? "is-playing" : ""}`}>
      <button
        ref={ref}
        type="button"
        className={`pad ${large ? "pad--large" : ""}`}
        aria-label={`Play effect ${label}`}
        title="Hit to play; hit again to start it over"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          hit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && playing) {
            event.preventDefault();
            event.stopPropagation();
            stopSfx(url);
            return;
          }
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          hit();
        }}
      >
        <svg className="pad__icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2 6h3l4-3v10l-4-3H2zM11 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6 6 0 0 1 0 9" />
        </svg>
        <span className="pad__label">{label}</span>
        {playing && length > 0 && (
          // Keyed by the hit, so every restart runs the bar from the beginning again.
          <span
            key={startedAt}
            className="pad__progress"
            style={{ animationDuration: `${length}s` }}
            aria-hidden="true"
          />
        )}
      </button>
      {playing && (
        <button
          type="button"
          className="pad__stop"
          aria-label={`Stop ${label}`}
          title="Stop"
          onClick={() => {
            stopSfx(url);
          }}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <rect x="2.5" y="2.5" width="7" height="7" rx="1" />
          </svg>
        </button>
      )}
    </div>
  );
}
