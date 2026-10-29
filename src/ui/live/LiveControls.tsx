import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import {
  answerKnock,
  leaveProject,
  live,
  removeMember,
  requestUsage,
  setInvitesOpen,
  savedName,
  shareStory,
  type LiveState,
  type Usage,
} from "@app/live/project";
import { ask, dismissNotice, showNotice } from "@app/store";
import { useStore } from "@ui/hooks/use-store";
import { Sheet } from "@ui/primitives/Sheet";
import { useServices } from "@ui/services/use-services";
import { personColor } from "./person-color";

import "./live.css";

const KNOCK_NOTICE = "wants to join. Open Shared to let them in.";

/** The title bar's Share button, and once shared, who is in and who is knocking. */
export function LiveControls() {
  const { deps } = useServices();
  const state = useStore(live, (s) => s.state);
  const hasStory = useStore(deps.document, (s) => s.story !== null);
  const [sharing, setSharing] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const closeShare = useCallback(() => {
    setSharing(false);
  }, []);
  const closePanel = useCallback(() => {
    setPanelOpen(false);
  }, []);

  // A knock is easy to miss in the title bar; it also shows as a notice.
  const knockCount = state.kind === "open" ? state.knocks.length : 0;
  const lastKnock = state.kind === "open" ? state.knocks.at(-1) : undefined;
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (lastKnock === undefined || announced.current === lastKnock.peer) return;
    announced.current = lastKnock.peer;
    showNotice(deps.notices, { tone: "info", title: `${lastKnock.name} ${KNOCK_NOTICE}` });
  }, [lastKnock, deps.notices]);

  // Answered: the notice has done its job.
  useEffect(() => {
    if (knockCount > 0) return;
    if (deps.notices.getState().notice?.title.endsWith(KNOCK_NOTICE) === true) {
      dismissNotice(deps.notices);
    }
  }, [knockCount, deps.notices]);

  if (state.kind === "off") {
    if (!hasStory) return null;
    return (
      <>
        <button
          type="button"
          className="live__button"
          title="Edit this story together with friends, also in real time"
          onClick={() => {
            setSharing(true);
          }}
        >
          <span className="live__dot" aria-hidden="true" />
          Share
        </button>
        {sharing && <ShareDialog onClose={closeShare} />}
      </>
    );
  }

  if (state.kind !== "open") return null;
  const here = state.people.length + 1;

  return (
    <div className="live">
      <button
        type="button"
        className={[
          "live__button is-on",
          state.connection === "offline" ? "is-offline" : "",
          knockCount > 0 ? "has-knock" : "",
        ].join(" ")}
        aria-expanded={panelOpen}
        title={state.connection === "online" ? "Shared project" : "Offline: changes are kept here"}
        onClick={() => {
          setPanelOpen((open) => !open);
        }}
      >
        <span className="live__dot" aria-hidden="true" />
        {state.connection === "online" ? `Shared · ${here}` : "Shared · offline"}
        {knockCount > 0 && <span className="live__count">{knockCount}</span>}
      </button>
      {panelOpen && <ProjectPanel state={state} onClose={closePanel} />}
    </div>
  );
}

function ProjectPanel({
  state,
  onClose,
}: {
  state: Extract<LiveState, { kind: "open" }>;
  onClose: () => void;
}) {
  const { deps, prompts } = useServices();
  const ref = useRef<HTMLDivElement | null>(null);
  const owner = state.project.role === "owner";

  useEffect(() => {
    const close = (event: Event) => {
      const outside = !ref.current?.parentElement?.contains(event.target as Node);
      if (event instanceof KeyboardEvent ? event.key === "Escape" : outside) onClose();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [onClose]);

  const copy = (text: string, what: string) => {
    void navigator.clipboard.writeText(text).then(
      () => {
        showNotice(deps.notices, { tone: "info", title: `${what} copied.` });
      },
      () => {
        showNotice(deps.notices, {
          tone: "error",
          title: "Could not copy. Select the code instead.",
        });
      },
    );
  };

  const confirmRemove = async (member: string, name: string) => {
    const choice = await ask(prompts, {
      title: `Remove ${name}?`,
      message: "They lose access to this project. The copy on their computer stays theirs.",
      actions: [
        { label: "Cancel", value: "cancel" },
        { label: "Remove", value: "remove", tone: "danger" },
      ],
      cancelValue: "cancel",
    });
    if (choice === "remove") removeMember(member);
  };

  const here = new Map(state.people.map((person) => [person.name, person]));

  // Fresh numbers each time the panel opens.
  useEffect(() => {
    requestUsage();
  }, []);

  return (
    <div ref={ref} className="live__panel" role="dialog" aria-label="Shared project">
      <p className="live__status">
        <span className={`live__state is-${state.connection}`} aria-hidden="true" />
        {state.connection === "online"
          ? state.unsent > 0
            ? "Sending changes…"
            : "Everything is in sync"
          : "Offline. Changes are kept on this computer and sent when back online."}
      </p>

      {owner && state.usage !== null && <CloudSpace usage={state.usage} />}

      {state.code !== null && (
        <section className="live__section">
          <h3>Invite</h3>
          <p className="live__note">
            Send this code to a friend. They ask to join with it and you let them in once; after
            that the project is on their start screen.
          </p>
          <div className="live__code">
            <code>{state.code}</code>
            <button
              type="button"
              className="live__action"
              onClick={() => copy(state.code ?? "", "Invite code")}
            >
              Copy
            </button>
          </div>
          <button
            type="button"
            className="live__action is-primary"
            title="A message with the code and how to join, ready to paste into a chat"
            onClick={() =>
              copy(
                `Join my story "${state.project.title || "Untitled"}" in SAMPO Studio: open SAMPO, choose "Join a shared project" and paste this code:

${state.code ?? ""}`,
                "Invite message",
              )
            }
          >
            Copy invite message
          </button>
          <label className="live__toggle">
            <input
              type="checkbox"
              checked={state.invitesOpen}
              onChange={(event) => {
                setInvitesOpen(event.target.checked);
              }}
            />
            Let new people ask to join
          </label>
          {!state.invitesOpen && (
            <p className="live__note">
              Closed: the code no longer lets anyone knock. Members still come and go.
            </p>
          )}
        </section>
      )}

      {state.knocks.length > 0 && (
        <section className="live__section">
          <h3>Wants to join</h3>
          <p className="live__note">Let in only someone you expect: anyone can type any name.</p>
          {state.knocks.map((knock) => (
            <div key={knock.peer} className="live__row">
              <span>
                {knock.name}
                {knock.duplicate && (
                  <span className="live__warning">
                    Same name as someone already in the project. Check it is really them.
                  </span>
                )}
              </span>
              <button
                type="button"
                className="live__action is-primary"
                onClick={() => answerKnock(knock.peer, true)}
              >
                Let in
              </button>
              <button
                type="button"
                className="live__action"
                onClick={() => answerKnock(knock.peer, false)}
              >
                Decline
              </button>
            </div>
          ))}
        </section>
      )}

      <section className="live__section">
        <h3>{owner ? "Members" : "Here now"}</h3>
        <div className="live__row">
          <span className="live__person">
            <span className="live__swatch is-you" aria-hidden="true" />
            You{owner ? " (owner)" : ""}
          </span>
        </div>
        {!owner && <p className="live__note">Owner: {state.project.ownerName || "unknown"}</p>}
        {owner
          ? state.members.map((member) => {
              const person = here.get(member.name);
              return (
                <div key={member.member} className="live__row">
                  <span className="live__person">
                    <span
                      className="live__swatch"
                      style={{
                        background: person === undefined ? "transparent" : personColor(person.peer),
                      }}
                      aria-hidden="true"
                    />
                    {member.name}
                    <span className="live__presence">{member.online ? "here" : "away"}</span>
                  </span>
                  <button
                    type="button"
                    className="live__action"
                    onClick={() => {
                      void confirmRemove(member.member, member.name);
                    }}
                  >
                    Remove
                  </button>
                </div>
              );
            })
          : state.people.map((person) => (
              <div key={person.peer} className="live__row">
                <span className="live__person">
                  <span
                    className="live__swatch"
                    style={{ background: personColor(person.peer) }}
                    aria-hidden="true"
                  />
                  {person.name}
                </span>
              </div>
            ))}
      </section>

      <button
        type="button"
        className="live__action live__leave"
        onClick={() => {
          onClose();
          void leaveProject(deps, prompts);
        }}
      >
        {owner ? "Delete project for everyone…" : "Leave project…"}
      </button>
    </div>
  );
}

const megabytes = (bytes: number) =>
  bytes === 0
    ? "0 MB"
    : bytes < 100 * 1024
      ? "<0.1 MB"
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** How much of the project's cloud space is in use: the text, and files on their way. */
function CloudSpace({ usage }: { usage: Usage }) {
  const used = usage.text + usage.files;
  const share = Math.min(1, used / usage.limit);
  return (
    <section className="live__section">
      <h3>Cloud space</h3>
      <div
        className="live__meter"
        role="meter"
        aria-label="Cloud space used"
        aria-valuemin={0}
        aria-valuemax={usage.limit}
        aria-valuenow={used}
      >
        <span style={{ width: `${Math.max(share * 100, used > 0 ? 1 : 0)}%` }} />
      </div>
      <dl className="live__usage">
        <div>
          <dt>Story text</dt>
          <dd>{megabytes(usage.text)}</dd>
        </div>
        <div>
          <dt>Files on their way</dt>
          <dd>{megabytes(usage.files)}</dd>
        </div>
        <div>
          <dt>Space</dt>
          <dd>{Math.round(usage.limit / (1024 * 1024))} MB</dd>
        </div>
      </dl>
      <p className="live__note">
        Pictures and sounds live on your computers. The cloud holds each one only until everyone has
        it.
      </p>
    </section>
  );
}

function ShareDialog({ onClose }: { onClose: () => void }) {
  const { deps } = useServices();
  const [name, setName] = useState(savedName);

  const start = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === "") return;
    void shareStory(deps, name.trim()).then(onClose);
  };

  return (
    <Sheet title="Share this story" className="live-sheet" onClose={onClose}>
      <form className="sheet__body live__form" onSubmit={start}>
        <ul className="live__points">
          <li>
            Friends you invite edit it with you, in real time when you are both here and on their
            own when you are away. It stays on everyone&rsquo;s start screen.
          </li>
          <li>Encrypted on each computer: not even the relay in between can read the story.</li>
          <li>
            Nothing is lost: every computer keeps the whole story and a version history, and your
            own file stays yours.
          </li>
        </ul>
        <label className="live__field">
          <span>Your name, as friends see it</span>
          <input
            value={name}
            maxLength={40}
            required
            autoFocus
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </label>
        <button type="submit" className="live__action is-primary live__submit">
          Share
        </button>
      </form>
    </Sheet>
  );
}
