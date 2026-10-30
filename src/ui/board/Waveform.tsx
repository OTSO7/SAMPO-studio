import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { cachedPeaks, loadPeaks, type Peaks } from "@app/peaks";
import { currentTime, formatTime, playback, seek, seekTo } from "@app/playback";
import { useStore } from "@ui/hooks/use-store";
import { useServices } from "@ui/services/use-services";

interface WaveformProps {
  url: string;
  label: string;
  /** Known length in seconds before the track is loaded, from the file's header. */
  length: number;
  /** Taller, with a time under the pointer, for the now-playing bar. */
  large?: boolean;
}

const BAR = 2;
const GAP = 1;
/** In safe audio mode, during a song the pointer must travel this far before it moves the song. */
const DRAG_PX = 6;

/**
 * The loaded track's waveform, which is also where you move in it: hold and drag to scrub, with
 * the sound following. A click jumps there, except during a song in safe audio mode. The played part fills in as it plays.
 * Arrow keys step five seconds. Without a measured waveform it is a plain line that works the
 * same.
 */
export function Waveform({ url, label, length, large = false }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const state = useStore(playback, (s) => (s.url === url ? s : null));
  const [peaks, setPeaks] = useState<Peaks | null>(() => cachedPeaks(url));
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const safeAudio = useStore(
    useServices().deps.document,
    (s) => s.story?.settings?.safeAudio === true,
  );
  const lastSeek = useRef(0);
  const pressedAt = useRef<number | null>(null);
  const current = state !== null;
  const duration = state !== null && state.duration > 0 ? state.duration : length;

  // Measured once the track is played, so a page of cards never reads every file at once.
  useEffect(() => {
    if (!current || peaks !== null) return;
    let live = true;
    void loadPeaks(url).then((found) => {
      if (live && found !== null) setPeaks(found);
    });
    return () => {
      live = false;
    };
  }, [current, peaks, url]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.round(entry?.contentRect.width ?? 0));
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
    };
  }, []);

  // Drawn every frame while playing, so the fill moves smoothly; otherwise when anything changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const draw = () => {
      // Read here rather than waiting for the observer, so a new view draws on its first frame.
      const wide = Math.round(canvas.clientWidth) || width;
      if (wide === 0) return;
      const time = drag !== null ? drag * duration : current ? currentTime() : 0;
      paint(canvas, wide, peaks, duration > 0 ? time / duration : 0, hover);
    };
    draw();
    if (state?.playing !== true || drag !== null) return;
    let frame = requestAnimationFrame(function loop() {
      draw();
      frame = requestAnimationFrame(loop);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [width, peaks, hover, drag, duration, current, state?.playing, state?.time]);

  const shareAt = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
  };

  const jump = (share: number, force: boolean) => {
    // Seeking a long WAV on every pointer move is fine, but twenty times a second is plenty.
    const now = performance.now();
    if (!force && now - lastSeek.current < 50) return;
    lastSeek.current = now;
    seekTo(url, share);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!current) return;
    const time = currentTime();
    const moves: Record<string, number> = {
      ArrowRight: time + 5,
      ArrowLeft: time - 5,
      Home: 0,
      End: duration - 1,
    };
    const to = moves[event.key];
    if (to === undefined) return;
    event.preventDefault();
    // Handled here: focus mode must not also turn the page on the same key.
    event.stopPropagation();
    seek(to);
  };

  const shown = drag ?? hover;
  return (
    <div
      className={`wave ${large ? "wave--large" : ""} ${drag !== null ? "is-dragging" : ""} ${current ? "" : "is-idle"}`}
      role="slider"
      tabIndex={0}
      aria-label={`Position in ${label}`}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(state?.time ?? 0)}
      aria-valuetext={`${formatTime(state?.time ?? 0)} of ${formatTime(duration)}`}
      onPointerDown={(event) => {
        if (event.button !== 0 || !current) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        pressedAt.current = event.clientX;
        // In safe audio mode, a slip of the hand during a song must not move it.
        if (safeAudio && state.playing) return;
        const share = shareAt(event);
        setDrag(share);
        jump(share, true);
      }}
      onPointerMove={(event) => {
        const share = shareAt(event);
        const pressed = pressedAt.current;
        if (drag === null && (pressed === null || Math.abs(event.clientX - pressed) < DRAG_PX)) {
          if (current) setHover(share);
          return;
        }
        setDrag(share);
        jump(share, false);
      }}
      onPointerUp={(event) => {
        pressedAt.current = null;
        if (drag === null) return;
        jump(shareAt(event), true);
        setDrag(null);
      }}
      onPointerCancel={() => {
        pressedAt.current = null;
        setDrag(null);
      }}
      onPointerLeave={() => {
        setHover(null);
      }}
      onKeyDown={onKeyDown}
    >
      <canvas ref={canvasRef} className="wave__canvas" aria-hidden="true" />
      {large && shown !== null && duration > 0 && (
        <span className="wave__tip" style={{ left: `${shown * 100}%` }}>
          {formatTime(shown * duration)}
        </span>
      )}
    </div>
  );
}

/** Bars from the peaks: played ones in the accent, the rest quiet, and a line where the pointer is. */
function paint(
  canvas: HTMLCanvasElement,
  width: number,
  peaks: Peaks | null,
  played: number,
  hover: number | null,
): void {
  const ratio = window.devicePixelRatio || 1;
  const height = canvas.clientHeight;
  if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
    canvas.width = width * ratio;
    canvas.height = height * ratio;
  }
  const context = canvas.getContext("2d");
  if (context === null) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  const styles = getComputedStyle(canvas);
  const accent = styles.getPropertyValue("--wave-played").trim() || "#f0a742";
  const quiet = styles.getPropertyValue("--wave-rest").trim() || "#555";
  const ahead = styles.getPropertyValue("--wave-hover").trim() || "#888";

  const bars = Math.max(1, Math.floor(width / (BAR + GAP)));
  const middle = height / 2;
  for (let bar = 0; bar < bars; bar++) {
    let level = 0.04;
    if (peaks !== null && peaks.length > 0) {
      const from = Math.floor((bar / bars) * peaks.length);
      const to = Math.max(from + 1, Math.floor(((bar + 1) / bars) * peaks.length));
      for (let i = from; i < to; i++) level = Math.max(level, peaks[i] ?? 0);
    }
    const share = (bar + 0.5) / bars;
    context.fillStyle = share <= played ? accent : hover !== null && share <= hover ? ahead : quiet;
    const barHeight = Math.max(2, level * (height - 2));
    context.fillRect(bar * (BAR + GAP), middle - barHeight / 2, BAR, barHeight);
  }
  // The playhead.
  if (played > 0) {
    context.fillStyle = accent;
    context.fillRect(Math.min(width - 1, played * width), 0, 1, height);
  }
}
