import { useCallback, useEffect, useState } from "react";

import { closeStory, save } from "@app/commands";
import { isDirty, showNotice } from "@app/store";
import { isPlaying } from "@app/playback";
import { checkForUpdate, type AvailableUpdate } from "@app/updates";
import { closeWindow, minimizeWindow, toggleMaximized, watchMaximized } from "@app/window";
import { useStore } from "@ui/hooks/use-store";
import { LiveControls } from "@ui/live/LiveControls";
import { MenuBar } from "./MenuBar";
import { Kbd } from "@ui/primitives/Kbd";
import { useServices } from "@ui/services/use-services";

export function Titlebar({
  onFocus,
  onShowSettings,
  onShowShortcuts,
  onShowWhatsNew,
}: {
  onFocus: (() => void) | null;
  onShowSettings: () => void;
  onShowShortcuts: () => void;
  onShowWhatsNew: () => void;
}) {
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
      <MenuBar
        onFocus={onFocus}
        onShowSettings={onShowSettings}
        onShowShortcuts={onShowShortcuts}
        onShowWhatsNew={onShowWhatsNew}
      />
      {title === null && <UpdateButton />}
      {title !== null && (
        <div className="shell__title" data-tauri-drag-region>
          {title}
          {dirty && <span className="shell__dirty" aria-label="Unsaved changes" />}
        </div>
      )}
      <LiveControls />
      {title !== null && (
        // For everyone who does not use Ctrl S; it lights up while there is something to save.
        <button
          type="button"
          className={`shell__save-button ${dirty ? "is-dirty" : ""}`}
          title="Save the story"
          onClick={() => void save(deps)}
        >
          Save
          <Kbd keys={["Ctrl", "S"]} />
        </button>
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

type UpdateState =
  | { readonly kind: "checking" }
  | { readonly kind: "current" }
  | { readonly kind: "failed" }
  | { readonly kind: "available"; readonly update: AvailableUpdate }
  | { readonly kind: "installing" };

/**
 * Says whether a newer SAMPO is out, checked as the start screen opens. Clicking installs an
 * update that is waiting, or checks again.
 */
function UpdateButton() {
  const { notices } = useServices().deps;
  const [state, setState] = useState<UpdateState>({ kind: "checking" });

  const check = useCallback(() => {
    checkForUpdate().then(
      (update) => {
        setState(update === null ? { kind: "current" } : { kind: "available", update });
      },
      () => {
        setState({ kind: "failed" });
      },
    );
  }, []);
  const run = () => {
    setState({ kind: "checking" });
    check();
  };

  // The state starts as "checking", so opening the start screen only has to ask.
  useEffect(check, [check]);

  const label = {
    checking: "Checking for updates…",
    current: "Up to date",
    failed: "Could not check for updates",
    installing: "Installing…",
    available: state.kind === "available" ? `Update ${state.update.version} available` : "",
  }[state.kind];

  return (
    <button
      type="button"
      className="shell__update"
      data-state={state.kind}
      disabled={state.kind === "checking" || state.kind === "installing"}
      title={state.kind === "available" ? "Install and restart" : "Check for updates"}
      onClick={() => {
        if (state.kind !== "available") {
          run();
          return;
        }
        if (isPlaying()) {
          showNotice(notices, {
            tone: "info",
            title: "Stop the music first: updating restarts the app.",
          });
          return;
        }
        const { update } = state;
        setState({ kind: "installing" });
        update.install().catch((error: unknown) => {
          setState({ kind: "available", update });
          showNotice(notices, {
            tone: "error",
            title: "The update could not be installed.",
            details: [String(error)],
          });
        });
      }}
    >
      <span className="shell__update-dot" aria-hidden="true" />
      {label}
    </button>
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
