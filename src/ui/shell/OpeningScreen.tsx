import { useEffect, useState } from "react";

import { opening } from "@app/files";
import { useStore } from "@ui/hooks/use-store";

const MB = 1024 * 1024;

/**
 * Covers the window while a story opens slowly, the first time a package with a lot of music
 * is unpacked on this computer. Quick opens never show it.
 */
export function OpeningScreen() {
  const state = useStore(opening, (s) => s);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!state.active) return;
    const timer = window.setTimeout(() => {
      setShown(true);
    }, 300);
    return () => {
      window.clearTimeout(timer);
      setShown(false);
    };
  }, [state.active]);

  if (!state.active || !shown) return null;
  const known = state.total > 0;
  const percent = known ? Math.min(100, (state.done / state.total) * 100) : 0;
  return (
    <div className="opening" role="status" aria-live="polite">
      <p className="opening__title">Importing…</p>
      <span className={`opening__bar ${known ? "" : "is-busy"}`} aria-hidden="true">
        {known && <span style={{ width: `${percent}%` }} />}
      </span>
      <p className="opening__detail">
        {known
          ? `Unpacking pictures and sounds: ${Math.round(state.done / MB)} of ${Math.round(state.total / MB)} MB`
          : "Reading the story"}
      </p>
      <p className="opening__note">
        Only the first time on this computer; it opens straight away after that.
      </p>
    </div>
  );
}
