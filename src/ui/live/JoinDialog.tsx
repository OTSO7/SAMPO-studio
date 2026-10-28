import { useEffect, useState, type FormEvent } from "react";

import { closeProject, joinProject, live, savedName } from "@app/live/project";
import { useStore } from "@ui/hooks/use-store";
import { Sheet } from "@ui/primitives/Sheet";
import { useServices } from "@ui/services/use-services";

import "./live.css";

/** Join a friend's shared project with the code they sent. */
export function JoinDialog({ onClose }: { onClose: () => void }) {
  const { deps } = useServices();
  const state = useStore(live, (s) => s.state);
  const [name, setName] = useState(savedName);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  // In: the project opens on the board.
  useEffect(() => {
    if (state.kind === "open") onClose();
  }, [state.kind, onClose]);

  const join = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    void joinProject(deps, code, name.trim()).then((ok) => {
      if (!ok) setError("That is not an invite code. It starts with SAMPO-.");
    });
  };

  const cancel = () => {
    if (state.kind === "joining") closeProject();
    onClose();
  };

  return (
    <Sheet title="Join a shared project" className="live-sheet" onClose={cancel}>
      {state.kind === "joining" ? (
        <div className="sheet__body live__form">
          <p className="live__waiting">
            <span className="live__dot" aria-hidden="true" />
            {state.stage === "connecting"
              ? "Connecting…"
              : "Waiting for the owner to let you in… They need to have SAMPO open."}
          </p>
          <button type="button" className="live__action" onClick={cancel}>
            Cancel
          </button>
        </div>
      ) : (
        <form className="sheet__body live__form" onSubmit={join}>
          <label className="live__field">
            <span>Invite code</span>
            <textarea
              value={code}
              rows={3}
              required
              autoFocus
              spellCheck={false}
              placeholder="SAMPO-…"
              onChange={(event) => {
                setCode(event.target.value);
              }}
            />
          </label>
          <label className="live__field">
            <span>Your name, as the others see it</span>
            <input
              value={name}
              maxLength={40}
              required
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </label>
          {error !== null && (
            <p className="live__error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="live__action is-primary live__submit">
            Ask to join
          </button>
        </form>
      )}
    </Sheet>
  );
}
