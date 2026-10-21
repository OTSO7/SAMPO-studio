import { isDirty, type DocumentState } from "@app/store";
import { useStore } from "@ui/hooks/use-store";
import { useServices } from "@ui/services/use-services";

const timeFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

function fileLabel(state: DocumentState): string {
  if (state.story === null) return "No file";
  if (state.path === null) return "Not saved";
  return state.path.split(/[\\/]/u).pop() ?? state.path;
}

export function Statusbar({ onShowShortcuts }: { onShowShortcuts: () => void }) {
  const { document } = useServices().deps;
  const file = useStore(document, fileLabel);
  const status = useStore(document, (state) => state.saveStatus);
  const dirty = useStore(document, isDirty);

  let saveLabel: string | null = null;
  if (status.kind === "saving") saveLabel = "Saving…";
  else if (status.kind === "failed") saveLabel = "Save failed";
  else if (dirty) saveLabel = "Edited";
  else if (status.kind === "saved") saveLabel = `Saved ${timeFormat.format(status.at)}`;

  return (
    <footer className="shell__statusbar">
      <span>{file}</span>
      <span className="shell__status-right">
        {saveLabel !== null && (
          <span className={status.kind === "failed" ? "shell__status--error" : undefined}>
            {saveLabel}
          </span>
        )}
        <button type="button" className="shell__status-button" onClick={onShowShortcuts}>
          Shortcuts <kbd className="kbd">?</kbd>
        </button>
        <span>v{__APP_VERSION__}</span>
      </span>
    </footer>
  );
}
