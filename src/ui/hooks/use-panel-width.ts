import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";

interface PanelWidthOptions {
  /** Remembered between sessions under this key, on this computer only. */
  readonly storageKey: string;
  readonly initial: number;
  readonly min: number;
  /** Space the rest of the window always keeps. */
  readonly reserve: number;
}

function readStored(key: string): number | null {
  try {
    const value = Number(window.localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function store(key: string, width: number) {
  try {
    window.localStorage.setItem(key, String(Math.round(width)));
  } catch {
    // Storage can be unavailable; the width simply is not remembered.
  }
}

/** Width of a panel resized from its left edge, clamped to fit the window. */
export function usePanelWidth({ storageKey, initial, min, reserve }: PanelWidthOptions) {
  const clamp = useCallback(
    (width: number) => Math.round(Math.max(min, Math.min(width, window.innerWidth - reserve))),
    [min, reserve],
  );
  const [width, setWidth] = useState(() => clamp(readStored(storageKey) ?? initial));

  useEffect(() => {
    const onResize = () => {
      setWidth((current) => clamp(current));
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [clamp]);

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = width;
      let latest = startWidth;
      document.body.classList.add("is-resizing");

      const move = (e: PointerEvent) => {
        latest = clamp(startWidth + (startX - e.clientX));
        setWidth(latest);
      };
      const up = () => {
        store(storageKey, latest);
        document.body.classList.remove("is-resizing");
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [width, clamp, storageKey],
  );

  const resizeBy = useCallback(
    (delta: number) => {
      setWidth((current) => {
        const next = clamp(current + delta);
        store(storageKey, next);
        return next;
      });
    },
    [clamp, storageKey],
  );

  const reset = useCallback(() => {
    const next = clamp(initial);
    store(storageKey, next);
    setWidth(next);
  }, [clamp, initial, storageKey]);

  return { width, startResize, resizeBy, reset };
}
