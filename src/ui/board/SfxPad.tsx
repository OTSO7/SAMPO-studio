import { useEffect, useRef } from "react";

import { playSfx, preloadSfx } from "@app/sfx";

/**
 * A soundboard pad: press it and the effect plays, press again and again and every hit plays
 * on top of the last. It fires on the press itself, not the release, so it keeps time with
 * a finger; Enter and Space hit it too, and holding a key repeats.
 */
export function SfxPad({
  url,
  label,
  large = false,
}: {
  url: string;
  label: string;
  large?: boolean;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);

  // Decoded before the first hit, so that one is instant too.
  useEffect(() => {
    void preloadSfx(url);
  }, [url]);

  const hit = () => {
    void playSfx(url);
    // A flash per hit, run by the compositor; restarting it costs nothing.
    ref.current?.animate(
      [
        { transform: "scale(0.94)", filter: "brightness(1.6)" },
        { transform: "none", filter: "none" },
      ],
      { duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
  };

  return (
    <button
      ref={ref}
      type="button"
      className={`pad ${large ? "pad--large" : ""}`}
      aria-label={`Play effect ${label}`}
      title="Hit to play; hit again to layer it"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        hit();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        hit();
      }}
    >
      <svg className="pad__icon" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2 6h3l4-3v10l-4-3H2zM11 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6 6 0 0 1 0 9" />
      </svg>
      <span className="pad__label">{label}</span>
    </button>
  );
}
