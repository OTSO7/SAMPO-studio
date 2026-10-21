import { useEffect, useRef } from "react";

import { useStore } from "@ui/hooks/use-store";
import { useServices } from "@ui/services/use-services";

/** The app's question dialog. Escape or a click outside counts as cancel. */
export function PromptDialog() {
  const { prompts } = useServices();
  const prompt = useStore(prompts, (state) => state.prompt);
  const primaryRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (prompt === null) return undefined;
    primaryRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        prompt.resolve(prompt.cancelValue);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [prompt]);

  if (prompt === null) return null;

  const primary =
    prompt.actions.find((action) => action.tone === "primary") ?? prompt.actions.at(-1);

  return (
    <div
      className="prompt-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) prompt.resolve(prompt.cancelValue);
      }}
    >
      <section
        className="prompt"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="prompt-title"
        aria-describedby="prompt-message"
      >
        <h2 id="prompt-title" className="prompt__title">
          {prompt.title}
        </h2>
        <p id="prompt-message" className="prompt__message">
          {prompt.message}
        </p>
        <div className="prompt__actions">
          {prompt.actions.map((action) => (
            <button
              key={action.value}
              ref={action === primary ? primaryRef : undefined}
              type="button"
              className={`prompt__action ${action.tone ? `prompt__action--${action.tone}` : ""}`}
              onClick={() => {
                prompt.resolve(action.value);
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
