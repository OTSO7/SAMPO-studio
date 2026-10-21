import { closeStory } from "@app/commands";
import { isDirty } from "@app/store";
import { useStore } from "@ui/hooks/use-store";
import { Kbd } from "@ui/primitives/Kbd";
import { useServices } from "@ui/services/use-services";

export function Titlebar({ onFocus }: { onFocus: (() => void) | null }) {
  const { deps } = useServices();
  const { document } = deps;
  const title = useStore(document, (state) => state.story?.title ?? null);
  const dirty = useStore(document, isDirty);

  return (
    <header className="shell__titlebar">
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
        <div className="shell__title">
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
    </header>
  );
}
