import { useEffect } from "react";

import { openReleaseNotes } from "@app/updates";
import changelog from "../../../CHANGELOG.md?raw";
import { highlightsOf, parseChangelog } from "./changelog";

/** The app shows the latest few, each by its highlights; everything is on the releases page. */
const RELEASES = parseChangelog(changelog).slice(0, 3).map(highlightsOf);

/** `code` in the changelog becomes code; everything else stays text. */
function Inline({ text }: { text: string }) {
  return text
    .split(/(`[^`]+`)/u)
    .map((part, index) =>
      part.startsWith("`") ? <code key={index}>{part.slice(1, -1)}</code> : part,
    );
}

export function WhatsNew({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onClose]);

  return (
    <div
      className="sheet-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="sheet whats-new" role="dialog" aria-modal="true" aria-label="What's new">
        <header className="sheet__head">
          <h2 className="sheet__title">What&rsquo;s new</h2>
          <button type="button" className="sheet__close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="sheet__body whats-new__body">
          {RELEASES.map((release) => (
            <article key={release.version} className="whats-new__release">
              <h3 className="whats-new__version">
                {release.version}
                {release.version === __APP_VERSION__ && (
                  <span className="whats-new__current">Installed</span>
                )}
                <span className="whats-new__date">{release.date}</span>
              </h3>
              {release.blocks.map((block, index) =>
                block.kind === "heading" ? (
                  <h4 key={index} className="whats-new__group">
                    {block.text}
                  </h4>
                ) : block.kind === "list" ? (
                  <ul key={index} className="whats-new__list">
                    {block.items.map((item, itemIndex) => (
                      <li key={itemIndex}>
                        <Inline text={item} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p key={index} className="whats-new__text">
                    <Inline text={block.text} />
                  </p>
                ),
              )}
              {release.trimmed && (
                <button
                  type="button"
                  className="whats-new__more"
                  onClick={() => void openReleaseNotes(release.version)}
                >
                  All changes in {release.version} →
                </button>
              )}
            </article>
          ))}
        </div>
        <footer className="whats-new__foot">
          <button
            type="button"
            className="button button--primary"
            onClick={() => void openReleaseNotes()}
          >
            Read all changes
          </button>
        </footer>
      </section>
    </div>
  );
}
