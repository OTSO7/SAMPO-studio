import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";

interface PanelHeightOptions {
  /** Remembered between sessions under this key, on this computer only. */
  readonly storageKey: string;
  readonly initial: number;
  readonly min: number;
  /** Largest share of the window the panel may take, e.g. 0.5. */
  readonly maxShare: number;
}

function readStored(key: string): number | null {
  try {
    const value = Number(window.localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function store(key: string, height: number) {
  try {
    window.localStorage.setItem(key, String(Math.round(height)));
  } catch {
    // Storage can be unavailable; the height simply is not remembered.
  }
}

/** Height of a panel docked at the bottom and resized from its top edge. */
export function usePanelHeight({ storageKey, initial, min, maxShare }: PanelHeightOptions) {
  const clamp = useCallback(
    (height: number) => Math.round(Math.max(min, Math.min(height, window.innerHeight * maxShare))),
    [min, maxShare],
  );
  const [height, setHeight] = useState(() => clamp(readStored(storageKey) ?? initial));

  useEffect(() => {
    const onResize = () => {
      setHeight((current) => clamp(current));
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
      const startY = event.clientY;
      const startHeight = height;
      let latest = startHeight;
      document.body.classList.add("is-resizing-rows");

      const move = (e: PointerEvent) => {
        latest = clamp(startHeight + (startY - e.clientY));
        setHeight(latest);
      };
      const up = () => {
        store(storageKey, latest);
        document.body.classList.remove("is-resizing-rows");
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [height, clamp, storageKey],
  );

  const resizeBy = useCallback(
    (delta: number) => {
      setHeight((current) => {
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
    setHeight(next);
  }, [clamp, initial, storageKey]);

  return { height, startResize, resizeBy, reset };
}
