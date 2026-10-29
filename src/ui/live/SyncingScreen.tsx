import { useEffect, useState } from "react";

import { closeProject, live, skipSyncGate } from "@app/live/project";
import { useStore } from "@ui/hooks/use-store";

import "./live.css";

const STAGE_TEXT = {
  connecting: "Connecting to the project…",
  receiving: "Getting the latest changes…",
  sending: "Sending the changes made on this computer…",
  files: "Bringing over pictures and sounds…",
} as const;

/**
 * Shown while a shared project opens, until this computer and the others are in sync. The
 * story cannot be edited before that, so nobody works on an old copy.
 */
export function SyncingScreen() {
  const state = useStore(live, (s) => s.state);
  const [patient, setPatient] = useState(false);
  const stage = state.kind === "open" ? (state.gate?.stage ?? null) : null;

  // Large recordings can take minutes: after a while the person may go on without them.
  useEffect(() => {
    if (stage !== "files") return;
    const timer = window.setTimeout(() => {
      setPatient(true);
    }, 10_000);
    return () => {
      window.clearTimeout(timer);
      setPatient(false);
    };
  }, [stage]);

  if (state.kind !== "open") return null;
  const gate = state.gate;
  const offline = gate?.offline === true || (gate === null && state.connection === "offline");
  return (
    <section className="syncing" aria-live="polite">
      <span className={`syncing__bar ${offline ? "is-stopped" : ""}`} aria-hidden="true" />
      <p className="syncing__title">{state.project.title || "Shared project"}</p>
      <p className="live__note">
        {offline
          ? "Cannot reach the cloud. This computer's copy may be missing the others' latest changes."
          : gate === null
            ? "Syncing the project to this computer…"
            : STAGE_TEXT[gate.stage]}
      </p>
      {gate?.stage === "files" && gate.filesTotal > 0 && (
        <p className="syncing__count">
          {gate.filesTotal - gate.filesLeft} of {gate.filesTotal} files
        </p>
      )}
      <p className="syncing__hint">
        {offline
          ? "Keep this open to sync as soon as the connection is back, or work on this copy: everything is merged later and nothing is lost."
          : "Editing starts once everyone's work is here, so nothing is done on an old copy."}
      </p>
      <span className="syncing__actions">
        {(offline || patient) && (
          <button type="button" className="live__action is-primary" onClick={skipSyncGate}>
            {offline ? "Work offline" : "Open without the missing files"}
          </button>
        )}
        <button type="button" className="live__action" onClick={closeProject}>
          Back to start
        </button>
      </span>
    </section>
  );
}
