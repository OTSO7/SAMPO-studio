import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";

import { ask, editStory } from "@app/store";
import {
  addPhase,
  deleteBeat,
  deletePhase,
  findBeat,
  mergePhaseWithPrevious,
  moveBeat,
  setStoryTitle,
  splitPhaseAt,
  updatePhase,
  type Beat,
  type BeatId,
  type Phase,
  type Story,
} from "@core/model";
import { usePanelWidth } from "@ui/hooks/use-panel-width";
import { EditableText } from "@ui/primitives/EditableText";
import { useServices } from "@ui/services/use-services";
import { BeatCard } from "./BeatCard";
import { ExportMenu } from "./ExportMenu";
import { Inspector } from "./Inspector";
import { insertCard, type InsertKind } from "./insert-card";
import { PacingPanel } from "./PacingPanel";
import { PhaseColumn } from "./PhaseColumn";
import { StorySettings } from "./StorySettings";
import { buildLookup } from "./story-lookup";
import { useCardDrag, type DropTarget } from "./use-card-drag";

import "./board.css";

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement)
  );
}

export function Board({ story }: { story: Story }) {
  const services = useServices();
  const { document: store } = services.deps;
  const { prompts } = services;
  const [selectedId, setSelectedId] = useState<BeatId | null>(null);
  const [focusOnOpen, setFocusOnOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showPacing, setShowPacing] = useState(() => readFlag("sampo.showPacing", true));
  const lookup = useMemo(() => buildLookup(story), [story]);
  const togglePacing = useCallback(() => {
    setShowPacing((current) => {
      writeFlag("sampo.showPacing", !current);
      return !current;
    });
  }, []);
  const panel = usePanelWidth({
    storageKey: "sampo.inspectorWidth",
    initial: 440,
    min: 340,
    reserve: 360,
  });
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const edit = useCallback(
    (recipe: (story: Story) => Story, group?: string) => {
      editStory(store, recipe, group === undefined ? {} : { group });
    },
    [store],
  );

  const drop = useCallback(
    (beatId: BeatId, target: DropTarget) => {
      edit((s) => moveBeat(s, beatId, target.phaseId, target.index));
      setSelectedId(beatId);
    },
    [edit],
  );

  const { dragging, dropTarget, ghostRef, onPointerDown, consumeClick } = useCardDrag(
    scrollerRef,
    drop,
  );

  const select = useCallback(
    (beat: Beat) => {
      if (consumeClick()) return;
      setFocusOnOpen(false);
      setSelectedId((current) => (current === beat.id ? null : beat.id));
    },
    [consumeClick],
  );

  const cardPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>, beat: Beat, phase: Phase) => {
      onPointerDown(event, beat.id, { phaseId: phase.id, index: phase.beats.indexOf(beat) });
    },
    [onPointerDown],
  );

  const rename = useCallback(
    (phase: Phase, title: string) => {
      edit((s) => updatePhase(s, phase.id, { title }));
    },
    [edit],
  );

  const relocate = useCallback(
    (phase: Phase, location: string) => {
      edit((s) => updatePhase(s, phase.id, { location }));
    },
    [edit],
  );

  const splitAt = useCallback(
    (beat: Beat) => {
      edit((s) => splitPhaseAt(s, beat.id));
    },
    [edit],
  );

  const removePhase = useCallback(
    async (phase: Phase) => {
      const count = phase.beats.length;
      if (count > 0) {
        const answer = await ask(prompts, {
          title: "Delete phase?",
          message: `“${phase.title}” and its ${count} ${count === 1 ? "card" : "cards"} will be deleted. You can undo this with Ctrl+Z.`,
          actions: [
            { label: "Cancel", value: "cancel" },
            { label: "Delete phase", value: "delete", tone: "primary" },
          ],
          cancelValue: "cancel",
        });
        if (answer !== "delete") return;
      }
      if (phase.beats.some((beat) => beat.id === selectedId)) setSelectedId(null);
      edit((s) => deletePhase(s, phase.id));
    },
    [prompts, edit, selectedId],
  );

  const mergeWithPrevious = useCallback(
    (phase: Phase) => {
      edit((s) => mergePhaseWithPrevious(s, phase.id));
    },
    [edit],
  );

  const insert = useCallback(
    (phase: Phase, index: number, kind: InsertKind) => {
      const current = store.getState().story;
      if (current === null) return;
      const result = insertCard(current, phase.id, index, kind);
      edit(() => result.story);
      setSelectedId(result.beatId);
      setFocusOnOpen(true);
    },
    [store, edit],
  );

  // Keyboard: arrows move the selection, Alt+arrows move the card, Delete removes it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.ctrlKey || event.metaKey || dragging !== null) return;
      if (settingsOpen) return;
      const current = selectedId === null ? null : findBeat(story, selectedId);

      if (current === null) {
        const first = story.phases.find((phase) => phase.beats.length > 0)?.beats[0];
        if (first !== undefined && event.key.startsWith("Arrow")) {
          event.preventDefault();
          setSelectedId(first.id);
        }
        return;
      }

      const { phaseIndex, beatIndex, beat } = current;
      const vertical = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
      const horizontal = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;

      if (event.altKey && (vertical !== 0 || horizontal !== 0)) {
        event.preventDefault();
        const targetPhase = story.phases[phaseIndex + horizontal];
        if (targetPhase === undefined) return;
        const index =
          horizontal === 0
            ? Math.max(0, beatIndex + vertical)
            : Math.min(beatIndex, targetPhase.beats.length);
        edit((s) => moveBeat(s, beat.id, targetPhase.id, index));
        return;
      }

      if (vertical !== 0 || horizontal !== 0) {
        event.preventDefault();
        const phase = story.phases[phaseIndex + horizontal];
        const beats = phase?.beats ?? [];
        const next =
          horizontal === 0
            ? beats[beatIndex + vertical]
            : beats[Math.min(beatIndex, beats.length - 1)];
        if (next !== undefined) setSelectedId(next.id);
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        const phase = story.phases[phaseIndex];
        const neighbour = phase?.beats[beatIndex + 1] ?? phase?.beats[beatIndex - 1];
        edit((s) => deleteBeat(s, beat.id));
        setSelectedId(neighbour?.id ?? null);
      } else if (event.key === "Enter") {
        event.preventDefault();
        document.querySelector<HTMLElement>(".inspector [data-autofocus]")?.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [story, selectedId, dragging, edit, settingsOpen]);

  useEffect(() => {
    if (selectedId === null) return;
    document
      .querySelector(`[data-beat-id="${selectedId}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [selectedId]);

  const selected = selectedId === null ? null : findBeat(story, selectedId);
  const draggedBeat = dragging === null ? null : findBeat(story, dragging.beatId);
  const cards = story.phases.reduce((total, phase) => total + phase.beats.length, 0);
  const lines = story.phases.reduce(
    (total, phase) =>
      total +
      phase.beats.reduce(
        (sum, beat) => sum + beat.blocks.filter((block) => block.type === "line").length,
        0,
      ),
    0,
  );

  return (
    <div
      className={`board ${selected === null ? "" : "board--inspecting"}`}
      style={{ "--inspector-width": `${panel.width}px` } as CSSProperties}
    >
      <div className="board__main">
        <header className="board__header">
          <EditableText
            className="board__title"
            label="story title"
            value={story.title}
            onCommit={(title) => {
              edit((s) => setStoryTitle(s, title));
            }}
          />
          <p className="board__meta">
            {story.phases.length} {story.phases.length === 1 ? "phase" : "phases"} · {cards}{" "}
            {cards === 1 ? "card" : "cards"} · {lines} {lines === 1 ? "line" : "lines"}
          </p>
          <div className="board__tools">
            <button
              type="button"
              className="board__tool"
              aria-pressed={showPacing}
              onClick={togglePacing}
            >
              Pacing
            </button>
            <button
              type="button"
              className="board__tool"
              onClick={() => {
                setSettingsOpen(true);
              }}
            >
              Card types &amp; cast
            </button>
            <ExportMenu />
          </div>
        </header>

        <div ref={scrollerRef} className={`board__scroller ${dragging ? "is-dragging" : ""}`}>
          <div className="board__columns">
            {story.phases.map((phase, index) => (
              <PhaseColumn
                key={phase.id}
                phase={phase}
                number={index + 1}
                lookup={lookup}
                selectedBeatId={selectedId}
                dragging={dragging}
                dropTarget={dropTarget}
                onSelect={select}
                onRename={rename}
                onRelocate={relocate}
                onSplitAt={splitAt}
                onMergeWithPrevious={index === 0 ? null : mergeWithPrevious}
                onDelete={(phase) => {
                  void removePhase(phase);
                }}
                onInsert={insert}
                onCardPointerDown={cardPointerDown}
              />
            ))}
            <button
              type="button"
              className="board__add-phase"
              onClick={() => {
                edit((s) => addPhase(s));
              }}
            >
              + Phase
            </button>
          </div>
        </div>

        {cards > 0 && (
          <PacingPanel
            story={story}
            open={showPacing}
            selectedBeatId={selectedId}
            edit={edit}
            onToggle={togglePacing}
            onSelect={(beatId) => {
              setFocusOnOpen(false);
              setSelectedId(beatId);
            }}
          />
        )}

        <footer className="board__hints">
          <span>Drag cards or Alt + arrows to reorder · Hover between cards to insert</span>
          <span>Arrows to move · Enter to write · Delete to remove</span>
        </footer>
      </div>

      {selected !== null && (
        <Inspector
          key={selected.beat.id}
          location={selected}
          story={story}
          autoFocus={focusOnOpen}
          edit={edit}
          onResizeStart={panel.startResize}
          onResizeBy={panel.resizeBy}
          onResizeReset={panel.reset}
          onClose={() => {
            setSelectedId(null);
          }}
        />
      )}

      {settingsOpen && (
        <StorySettings
          story={story}
          edit={edit}
          onClose={() => {
            setSettingsOpen(false);
          }}
        />
      )}

      {dragging !== null && draggedBeat !== null && (
        <div
          ref={ghostRef}
          className="card-ghost"
          style={{
            width: dragging.width,
            transform: `translate(${dragging.x}px, ${dragging.y}px) rotate(1.5deg)`,
          }}
          aria-hidden="true"
        >
          <BeatCard
            beat={draggedBeat.beat}
            number={`${draggedBeat.phaseIndex + 1}.${draggedBeat.beatIndex + 1}`}
            lookup={lookup}
          />
        </div>
      )}
    </div>
  );
}

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === "1";
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // Not remembered; harmless.
  }
}
