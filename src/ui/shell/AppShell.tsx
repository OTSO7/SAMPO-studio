import "./app-shell.css";

const APP_VERSION = "0.1.0";

const START_ACTIONS = [
  { label: "New story", keys: ["Ctrl", "N"] },
  { label: "Open…", keys: ["Ctrl", "O"] },
  { label: "Paste script", keys: ["Ctrl", "V"] },
] as const;

export function AppShell() {
  return (
    <div className="shell">
      <header className="shell__titlebar">
        <div className="shell__wordmark" aria-label="SAMPO Studio">
          <span className="shell__wordmark-mark" aria-hidden="true" />
          SAMPO
        </div>
      </header>

      <main className="shell__main">
        <section className="start" aria-label="Start">
          <p className="start__eyebrow">No story open</p>
          <ul className="start__actions">
            {START_ACTIONS.map((action) => (
              <li key={action.label} className="start__action">
                <span>{action.label}</span>
                <span className="start__keys">
                  {action.keys.map((key) => (
                    <kbd key={key}>{key}</kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="shell__statusbar">
        <span>No file</span>
        <span>v{APP_VERSION}</span>
      </footer>
    </div>
  );
}
