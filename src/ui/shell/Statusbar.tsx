import { live } from "@app/live/project";
import { isDirty, type DocumentState } from "@app/store";
import { useStore } from "@ui/hooks/use-store";
import { useServices } from "@ui/services/use-services";

const timeFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

function fileLabel(state: DocumentState): string {
  if (state.story === null) return "No file";
  if (state.path === null) return "Not saved";
  return state.path.split(/[\\/]/u).pop() ?? state.path;
}

export function Statusbar({
  onShowShortcuts,
  onShowWhatsNew,
}: {
  onShowShortcuts: () => void;
  onShowWhatsNew: () => void;
}) {
  const { document } = useServices().deps;
  const file = useStore(document, fileLabel);
  const status = useStore(document, (state) => state.saveStatus);
  const dirty = useStore(document, isDirty);
  const shared = useStore(live, (s) =>
    s.state.kind === "open"
      ? s.state.connection === "offline"
        ? "Offline · kept on this computer"
        : s.state.unsent > 0
          ? "Syncing…"
          : "In sync"
      : null,
  );
  const path = useStore(document, (state) => state.path);

  let saveLabel: string | null = null;
  if (status.kind === "saving") saveLabel = "Saving…";
  else if (status.kind === "failed") saveLabel = "Save failed";
  else if (status.kind === "conflict") saveLabel = "Changed on disk";
  // A shared project without a file is kept by the project itself, not by saving.
  else if (shared !== null && path === null) saveLabel = shared;
  else if (dirty) saveLabel = "Edited";
  else if (status.kind === "saved") saveLabel = `Saved ${timeFormat.format(status.at)}`;
  const error = status.kind === "failed" || status.kind === "conflict";
  const saved = status.kind === "saved" && !dirty;

  return (
    <footer className="shell__statusbar">
      <span>{shared !== null && path === null ? "Shared project" : file}</span>
      <span className="shell__status-right">
        {saveLabel !== null && (
          // Keyed by the label, so every save visibly lands instead of silently changing text.
          <span
            key={saveLabel}
            className={`shell__save ${error ? "shell__status--error" : ""} ${saved ? "is-saved" : ""}`}
            // The reason is one hover away, so a failed save can be explained and reported.
            title={status.kind === "failed" ? status.message : undefined}
          >
            {saveLabel}
          </span>
        )}
        <button type="button" className="shell__status-button" onClick={onShowShortcuts}>
          Shortcuts <kbd className="kbd">?</kbd>
        </button>
        <button
          type="button"
          className="shell__status-button"
          title="What's new"
          onClick={onShowWhatsNew}
        >
          v{__APP_VERSION__}
        </button>
      </span>
    </footer>
  );
}
