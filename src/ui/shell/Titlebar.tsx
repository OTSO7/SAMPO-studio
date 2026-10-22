import { useEffect, useState } from "react";

import { closeStory } from "@app/commands";
import { isDirty } from "@app/store";
import { closeWindow, minimizeWindow, toggleMaximized, watchMaximized } from "@app/window";
import { useStore } from "@ui/hooks/use-store";
import { Kbd } from "@ui/primitives/Kbd";
import { useServices } from "@ui/services/use-services";

export function Titlebar({ onFocus }: { onFocus: (() => void) | null }) {
  const { deps } = useServices();
  const { document } = deps;
  const title = useStore(document, (state) => state.story?.title ?? null);
  const dirty = useStore(document, isDirty);

  return (
    // The bar itself moves the window; double-clicking it maximizes, as in any Windows app.
    <header className="shell__titlebar" data-tauri-drag-region>
      {title === null ? (
        <div className="shell__wordmark" aria-label="SAMPO Studio">
          <span className="shell__wordmark-mark" aria-hidden="true" />
          SAMPO
        </div>
      ) : (
        <button
          type="button"
          className="shell__wordmark shell__wordmark--button"
          title="Close story and return to start"
          aria-label="Close story and return to start"
          onClick={() => void closeStory(deps)}
        >
          <span className="shell__wordmark-mark" aria-hidden="true" />
          SAMPO
        </button>
      )}
      {title !== null && (
        <div className="shell__title" data-tauri-drag-region>
          {title}
          {dirty && <span className="shell__dirty" aria-label="Unsaved changes" />}
        </div>
      )}
      {onFocus !== null && (
        <button type="button" className="shell__focus" onClick={onFocus}>
          <span className="shell__focus-icon" aria-hidden="true" />
          Focus
          <Kbd keys={["F5"]} />
        </button>
      )}
      <WindowButtons />
    </header>
  );
}

/** Minimize, maximize and close, drawn in the app's own style in place of the system frame. */
function WindowButtons() {
  const [maximized, setMaximized] = useState(true);

  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | null = null;
    void watchMaximized(setMaximized).then((remove) => {
      if (disposed) remove();
      else stop = remove;
    });
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);

  return (
    <div className="shell__window">
      <button
        type="button"
        className="shell__window-button"
        aria-label="Minimize"
        title="Minimize"
        onClick={() => void minimizeWindow()}
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5h10" />
        </svg>
      </button>
      <button
        type="button"
        className="shell__window-button"
        aria-label={maximized ? "Restore" : "Maximize"}
        title={maximized ? "Restore" : "Maximize"}
        onClick={() => void toggleMaximized()}
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          {maximized ? <path d="M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z" /> : <path d="M.5.5h9v9h-9z" />}
        </svg>
      </button>
      <button
        type="button"
        className="shell__window-button shell__window-button--close"
        aria-label="Close"
        title="Close"
        onClick={() => void closeWindow()}
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 0l10 10M10 0L0 10" />
        </svg>
      </button>
    </div>
  );
}
