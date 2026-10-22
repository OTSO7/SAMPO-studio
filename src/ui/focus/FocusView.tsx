import { useCallback, useEffect, useMemo, useState } from "react";

import { editStory } from "@app/store";
import { setFullscreen } from "@app/window";
import { updatePhase, type Beat, type Story } from "@core/model";
import { CardTypePicker, HeadingInput, TensionPicker } from "@ui/board/BeatFields";
import { insertCard, type InsertKind } from "@ui/board/insert-card";
import { ScriptEditor } from "@ui/board/ScriptEditor";
import { buildLookup } from "@ui/board/story-lookup";
import { useAddImages, useImageInput } from "@ui/board/use-images";
import { EditableText } from "@ui/primitives/EditableText";
import { Kbd } from "@ui/primitives/Kbd";
import { useServices } from "@ui/services/use-services";

import "./focus.css";

interface FocusViewProps {
  story: Story;
  initialPhase?: number;
  onExit: () => void;
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement)
  );
}

/**
 * Presents the story one phase at a time, full screen, for walking a team through it.
 * Everything stays editable, so notes from the meeting go straight into the story.
 */
export function FocusView({ story, initialPhase = 0, onExit }: FocusViewProps) {
  const { document: store } = useServices().deps;
  const [requested, setRequested] = useState(initialPhase);
  const [newCard, setNewCard] = useState<string | null>(null);
  const lookup = useMemo(() => buildLookup(story), [story]);

  const last = Math.max(story.phases.length - 1, 0);
  const index = Math.min(Math.max(requested, 0), last);
  const phase = story.phases[index];

  const edit = useCallback(
    (recipe: (story: Story) => Story, group?: string) => {
      editStory(store, recipe, group === undefined ? {} : { group });
    },
    [store],
  );
  useImageInput(useAddImages(edit), null);

  const go = useCallback(
    (target: number) => {
      setRequested(Math.min(Math.max(target, 0), last));
      setNewCard(null);
    },
    [last],
  );

  useEffect(() => {
    void setFullscreen(true);
    return () => {
      void setFullscreen(false);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target)) {
        if (event.key === "Escape") (event.target as HTMLElement).blur();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
        event.preventDefault();
        go(index + 1);
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        go(index - 1);
      } else if (event.key === "Home") {
        go(0);
      } else if (event.key === "End") {
        go(last);
      } else if (event.key === "Escape") {
        event.preventDefault();
        onExit();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [go, index, last, onExit]);

  const insert = (kind: InsertKind) => {
    const current = store.getState().story;
    if (current === null || phase === undefined) return;
    const result = insertCard(current, phase.id, phase.beats.length, kind);
    edit(() => result.story);
    setNewCard(result.beatId);
  };

  const previous = story.phases[index - 1];
  const next = story.phases[index + 1];

  return (
    <div className="focus" role="dialog" aria-modal="true" aria-label="Focus mode">
      <header className="focus__top">
        <span className="focus__story">{story.title}</span>
        <span className="focus__progress">
          Phase {index + 1} of {story.phases.length}
        </span>
        <button type="button" className="focus__exit" onClick={onExit}>
          Exit <Kbd keys={["Esc"]} />
        </button>
      </header>

      {phase === undefined ? (
        <main className="focus__stage focus__stage--empty">
          <p>This story has no phases yet.</p>
        </main>
      ) : (
        <main key={phase.id} className="focus__stage">
          <div className="focus__intro">
            <span className="focus__eyebrow">Phase {String(index + 1).padStart(2, "0")}</span>
            <EditableText
              className="focus__title"
              label="phase title"
              value={phase.title}
              placeholder="Untitled phase"
              onCommit={(title) => {
                edit((s) => updatePhase(s, phase.id, { title }));
              }}
            />
            <EditableText
              className="focus__location"
              label="location"
              value={phase.location ?? ""}
              placeholder="Add location"
              onCommit={(location) => {
                edit((s) => updatePhase(s, phase.id, { location }));
              }}
            />
          </div>

          <div className="focus__cards">
            {phase.beats.map((beat, beatIndex) => (
              <FocusCard
                key={beat.id}
                beat={beat}
                number={`${index + 1}.${beatIndex + 1}`}
                story={story}
                swatch={lookup.typeById.get(beat.typeId)?.color ?? "bone"}
                autoFocus={beat.id === newCard}
                edit={edit}
              />
            ))}
          </div>

          <div className="focus__add">
            <button
              type="button"
              onClick={() => {
                insert("card");
              }}
            >
              + Card
            </button>
            <button
              type="button"
              onClick={() => {
                insert("dialogue");
              }}
            >
              + Dialogue
            </button>
          </div>
        </main>
      )}

      <footer className="focus__nav">
        <button
          type="button"
          className="focus__step"
          disabled={previous === undefined}
          onClick={() => {
            go(index - 1);
          }}
        >
          <span aria-hidden="true">←</span>
          <span className="focus__step-label">{previous?.title ?? ""}</span>
        </button>

        <div className="focus__dots" role="tablist" aria-label="Phases">
          {story.phases.map((item, dot) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={dot === index}
              aria-label={`Phase ${dot + 1}: ${item.title}`}
              title={item.title}
              className="focus__dot"
              onClick={() => {
                go(dot);
              }}
            />
          ))}
        </div>

        <button
          type="button"
          className="focus__step focus__step--next"
          disabled={next === undefined}
          onClick={() => {
            go(index + 1);
          }}
        >
          <span className="focus__step-label">{next?.title ?? ""}</span>
          <span aria-hidden="true">→</span>
        </button>
      </footer>
    </div>
  );
}

function FocusCard({
  beat,
  number,
  story,
  swatch,
  autoFocus,
  edit,
}: {
  beat: Beat;
  number: string;
  story: Story;
  swatch: string;
  autoFocus: boolean;
  edit: (recipe: (story: Story) => Story, group?: string) => void;
}) {
  return (
    <article className="focus-card" data-swatch={swatch} data-beat-id={beat.id}>
      <header className="focus-card__head">
        <span className="focus-card__number">{number}</span>
        <HeadingInput beat={beat} edit={edit} className="focus-card__heading" />
      </header>
      <ScriptEditor beat={beat} story={story} edit={edit} size="large" autoFocus={autoFocus} />
      <footer className="focus-card__foot">
        <CardTypePicker beat={beat} story={story} edit={edit} />
        <TensionPicker beat={beat} edit={edit} />
      </footer>
    </article>
  );
}
