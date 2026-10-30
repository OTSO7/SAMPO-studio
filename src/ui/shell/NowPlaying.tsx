import { useEffect, useRef, type MouseEvent, type PointerEvent } from "react";

import { formatTime, playback } from "@app/playback";
import { PlayIcon } from "@ui/board/AudioPlayer";
import { keepKeysHere, usePlayerActions } from "@ui/board/use-player-actions";
import { Waveform } from "@ui/board/Waveform";
import { useStore } from "@ui/hooks/use-store";
import { useServices } from "@ui/services/use-services";

/** Dropped this close to its corner, the deck snaps home. */
const SNAP_PX = 140;
/** Where the deck was left, per corner, for as long as the app runs. */
const placed = { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };

/**
 * Lets the deck be dragged anywhere by its body, snapping back to its corner when dropped
 * near it (or double-clicked). Moving it only changes a CSS transform on the element, never
 * React state, so dragging costs the page nothing and the music, which plays in its own
 * element, cannot stutter.
 */
function useDraggable(placement: "left" | "right") {
  const ref = useRef<HTMLElement | null>(null);
  const drag = useRef<{ startX: number; startY: number; fromX: number; fromY: number } | null>(
    null,
  );
  // Read in handlers only: moves are written to the module's record, never React state.
  const spot = () => placed[placement];

  const apply = (x: number, y: number, snapping: boolean) => {
    const deck = ref.current;
    if (deck === null) return;
    deck.classList.toggle("is-snapping", snapping);
    deck.style.transform = x === 0 && y === 0 ? "" : `translate3d(${x}px, ${y}px, 0)`;
    const where = spot();
    where.x = x;
    where.y = y;
  };

  // Back where it was left after switching between the board and focus mode.
  useEffect(() => {
    const deck = ref.current;
    if (deck !== null && (spot().x !== 0 || spot().y !== 0)) {
      deck.style.transform = `translate3d(${spot().x}px, ${spot().y}px, 0)`;
    }
  });

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    // Buttons and the waveform keep their own clicks and drags.
    if (event.button !== 0 || (event.target as Element).closest("button, .wave") !== null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      startX: event.clientX,
      startY: event.clientY,
      fromX: spot().x,
      fromY: spot().y,
    };
    event.currentTarget.classList.add("is-dragging");
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const from = drag.current;
    const deck = ref.current;
    if (from === null || deck === null) return;
    let x = from.fromX + event.clientX - from.startX;
    let y = from.fromY + event.clientY - from.startY;
    // Kept on screen: the box measured without the current move, then clamped.
    const box = deck.getBoundingClientRect();
    const left = box.left - spot().x + x;
    const top = box.top - spot().y + y;
    x -= Math.min(0, left) + Math.max(0, left + box.width - window.innerWidth);
    y -= Math.min(0, top) + Math.max(0, top + box.height - window.innerHeight);
    apply(x, y, false);
  };

  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    if (drag.current === null) return;
    drag.current = null;
    event.currentTarget.classList.remove("is-dragging");
    if (Math.hypot(spot().x, spot().y) < SNAP_PX) apply(0, 0, true);
  };

  return {
    ref,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onDoubleClick: (event: MouseEvent<HTMLElement>) => {
      if ((event.target as Element).closest("button, .wave") === null) apply(0, 0, true);
    },
  };
}

/**
 * The sound that is on, wherever you are in the app: its name and time over its waveform,
 * which you can press or drag to move in it, with back to the start, play or pause, and stop.
 * Keeps the screen from sleeping while it plays.
 *
 * `left` puts it in the bottom left corner, clear of focus mode's next-phase button.
 */
export function NowPlaying({ placement = "right" }: { placement?: "left" | "right" }) {
  const state = useStore(playback, (s) => s);
  const draggable = useDraggable(placement);
  const actions = usePlayerActions();
  const safeAudio = useStore(
    useServices().deps.document,
    (s) => s.story?.settings?.safeAudio === true,
  );

  useEffect(() => {
    if (!state.playing) return;
    let lock: WakeLockSentinel | null = null;
    let released = false;
    navigator.wakeLock
      .request("screen")
      .then((sentinel) => {
        if (released) void sentinel.release();
        else lock = sentinel;
      })
      .catch(() => {
        // Without a wake lock the music still plays; the screen may just dim.
      });
    return () => {
      released = true;
      void lock?.release();
    };
  }, [state.playing]);

  const { url } = state;
  if (url === null) return null;
  return (
    <section
      className={`deck deck--${placement} ${state.playing ? "is-playing" : ""}`}
      aria-label="Now playing"
      title="Drag to move; drop near the corner or double-click to put it back"
      onKeyDown={keepKeysHere}
      {...draggable}
    >
      <div className="deck__controls">
        <button
          type="button"
          className="deck__button"
          aria-label="Back to the start"
          title="Back to the start"
          onClick={actions.restart}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 2h1.6v8H2zM10.5 2v8L4.5 6z" />
          </svg>
        </button>
        <button
          type="button"
          className="deck__play"
          aria-label={`${state.playing ? "Pause" : "Play"} ${state.label}`}
          onClick={() => {
            actions.play(url, state.label);
          }}
        >
          <PlayIcon playing={state.playing} />
        </button>
      </div>
      <div className="deck__main">
        <div className="deck__head">
          <span className="deck__label" title={state.label}>
            {state.label}
          </span>
          {safeAudio && (
            <span
              className="deck__safe"
              title="Safe audio mode is on: the app asks before cutting the song"
            >
              Safe
            </span>
          )}
          <span className={`deck__time ${state.error === null ? "" : "is-error"}`}>
            {state.error ?? (
              <>
                {formatTime(state.time)}
                <span className="deck__total"> / {formatTime(state.duration)}</span>
              </>
            )}
          </span>
        </div>
        <Waveform url={url} label={state.label} length={state.duration} large />
      </div>
      <button
        type="button"
        className="deck__close"
        aria-label="Stop and close"
        title="Stop"
        onClick={actions.stop}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 3l6 6M9 3l-6 6" />
        </svg>
      </button>
    </section>
  );
}
