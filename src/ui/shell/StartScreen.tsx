import { importScript, newStory, openStory } from "@app/commands";
import { showNotice } from "@app/store";
import { Kbd } from "@ui/primitives/Kbd";
import { useServices } from "@ui/services/use-services";

export function StartScreen() {
  const { deps } = useServices();

  const pasteFromClipboard = async () => {
    try {
      if (!(await importScript(deps, await navigator.clipboard.readText()))) {
        showNotice(deps.notices, { tone: "info", title: "Clipboard is empty" });
      }
    } catch {
      showNotice(deps.notices, { tone: "info", title: "Press Ctrl V to paste a script" });
    }
  };

  const actions = [
    { label: "New story", keys: ["Ctrl", "N"], run: () => newStory(deps) },
    { label: "Open…", keys: ["Ctrl", "O"], run: () => openStory(deps) },
    { label: "Paste script", keys: ["Ctrl", "V"], run: pasteFromClipboard },
  ];

  return (
    <section className="start" aria-label="Start">
      <p className="start__eyebrow">No story open</p>
      <ul className="start__actions">
        {actions.map((action) => (
          <li key={action.label}>
            <button type="button" className="start__action" onClick={() => void action.run()}>
              <span>{action.label}</span>
              <Kbd keys={action.keys} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
