import { useEffect, useState } from "react";

import { listBackups, readBackup, type Backup } from "@app/backups";
import { closeStory } from "@app/commands";
import { deserializeStory } from "@core/file";
import { newId } from "@core/model";
import { loadDocument, showNotice } from "@app/store";
import { Sheet } from "@ui/primitives/Sheet";
import { useServices } from "@ui/services/use-services";

import "./live.css";

const REASONS: Readonly<Record<string, string>> = {
  opened: "When opened",
  autosave: "While editing",
  "before-others-changes": "Before someone else's changes",
  shared: "When shared",
  "before-leaving": "Before leaving the project",
};

const when = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Earlier versions of the open story, kept automatically. Opening one opens a copy beside
 * the story, never in its place, so going back is never one more thing that can lose work.
 */
export function HistorySheet({ storyId, onClose }: { storyId: string; onClose: () => void }) {
  const { deps } = useServices();
  const [backups, setBackups] = useState<readonly Backup[] | null>(null);

  useEffect(() => {
    listBackups(storyId).then(setBackups, () => {
      setBackups([]);
    });
  }, [storyId]);

  const openCopy = async (backup: Backup) => {
    try {
      const loaded = deserializeStory(await readBackup(backup.path));
      if (!loaded.ok) throw new Error(loaded.errors.join(", "));
      if (!(await closeStory(deps))) return;
      // A new id: the copy is a story of its own, not the shared one under an old name.
      const copy = {
        ...loaded.story,
        id: newId.story(),
        title: `${loaded.story.title} (${when.format(backup.modified)})`,
      };
      loadDocument(deps.document, copy, null);
      onClose();
      showNotice(deps.notices, {
        tone: "info",
        title: "Opened an earlier version as a copy. Save it to keep it.",
      });
    } catch (error) {
      showNotice(deps.notices, {
        tone: "error",
        title: "Could not open that version",
        details: [error instanceof Error ? error.message : String(error)],
      });
    }
  };

  return (
    <Sheet title="Version history" className="live-sheet" onClose={onClose}>
      <div className="sheet__body live__form">
        <p className="live__note">
          SAMPO keeps a complete copy when a story opens, every ten minutes of editing, and before
          someone else&rsquo;s deletions. Opening one opens a copy; the story itself stays as it is.
        </p>
        {backups === null ? (
          <p className="live__note">Loading…</p>
        ) : backups.length === 0 ? (
          <p className="live__note">No earlier versions yet.</p>
        ) : (
          <ul className="history">
            {backups.map((backup) => {
              const reason = /\s(\S+)\.sampo$/u.exec(backup.name)?.[1] ?? "";
              return (
                <li key={backup.path} className="live__row">
                  <span className="history__when">
                    {when.format(backup.modified)}
                    <span className="live__presence">{REASONS[reason] ?? ""}</span>
                  </span>
                  <button
                    type="button"
                    className="live__action"
                    onClick={() => {
                      void openCopy(backup);
                    }}
                  >
                    Open copy
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
