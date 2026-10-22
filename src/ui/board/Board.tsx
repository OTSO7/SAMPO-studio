import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";

import { flushSync } from "react-dom";

import { ask, editStory } from "@app/store";
import {
  addPhase,
  BEAT_STATUSES,
  deleteBeat,
  deletePhase,
  findBeat,
  mergePhaseWithPrevious,
  moveBeat,
  setStoryTitle,
  splitPhaseAt,
  updateBeat,
  updatePhase,
  type Beat,
  type BeatId,
  type BeatStatus,
  type Phase,
  type Story,
} from "@core/model";
import type { SearchResult } from "@core/search";
import { usePanelWidth } from "@ui/hooks/use-panel-width";
import { LinesView } from "@ui/lines/LinesView";
import { EditableText } from "@ui/primitives/EditableText";
import { useServices } from "@ui/services/use-services";
import { BeatCard } from "./BeatCard";
import { ExportMenu } from "./ExportMenu";
import { Inspector } from "./Inspector";
import { insertCard, type InsertKind } from "./insert-card";
import { PacingPanel } from "./PacingPanel";
import { PhaseColumn } from "./PhaseColumn";
import { QuickFind } from "./QuickFind";
import { STATUS_NAMES } from "./status";
import { StorySettings } from "./StorySettings";
import { buildLookup } from "./story-lookup";
import { useCardDrag, type DropTarget } from "./use-card-drag";
import { useAddImages, useImageInput } from "./use-images";

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
  const [view, setView] = useState<"board" | "lines">(() =>
    readText("sampo.view") === "lines" ? "lines" : "board",
  );
  const [zoom, setZoom] = useState(() => clampZoom(Number(readText("sampo.zoom") ?? "1")));
  const zoomRef = useRef(zoom);
  /** Cards in other states fade back, so a review pass sees only what it needs. */
  const [statusFilter, setStatusFilter] = useState<BeatStatus | null>(null);

  const changeView = useCallback((next: "board" | "lines") => {
    setView(next);
    writeText("sampo.view", next);
  }, []);

  const changeZoom = useCallback((next: number) => {
    const clamped = clampZoom(next);
    setZoom(clamped);
    writeText("sampo.zoom", String(clamped));
  }, []);

  /** Buttons and keys move in clean 10 % steps from wherever the wheel left the zoom. */
  const stepZoom = useCallback(
    (direction: 1 | -1) => {
      changeZoom(Math.round((zoom + direction * ZOOM_STEP) * 10) / 10);
    },
    [zoom, changeZoom],
  );

  const openCard = useCallback(
    (beatId: BeatId) => {
      changeView("board");
      setFocusOnOpen(false);
      setSelectedId(beatId);
    },
    [changeView],
  );

  const pickResult = useCallback(
    (result: SearchResult) => {
      if (result.beatId !== undefined) {
        openCard(result.beatId);
        return;
      }
      changeView("board");
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-phase-id="${result.phaseId}"]`)
          ?.scrollIntoView({ inline: "start", block: "nearest", behavior: "smooth" });
      });
    },
    [openCard, changeView],
  );

  // Ctrl + / - / 0 zoom. These work even while typing.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "=" || key === "+") {
        event.preventDefault();
        stepZoom(1);
      } else if (key === "-") {
        event.preventDefault();
        stepZoom(-1);
      } else if (key === "0") {
        event.preventDefault();
        changeZoom(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [stepZoom, changeZoom]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Ctrl + wheel (or a trackpad pinch) zooms around the pointer, as in design tools: the
  // spot under the cursor stays under the cursor.
  const hasColumns = view === "board" && story.phases.length > 0;
  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>(".board__scroller");
    if (!hasColumns || scroller === null) return undefined;

    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();

      const current = zoomRef.current;
      const next = clampZoom(current * Math.exp(-event.deltaY * WHEEL_SENSITIVITY));
      if (next === current) return;

      const rect = scroller.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      // The point under the pointer, in unzoomed board coordinates.
      const contentX = (scroller.scrollLeft + pointerX) / current;
      const contentY = (scroller.scrollTop + pointerY) / current;

      // Apply the zoom synchronously so the new layout exists before scrolling back to
      // the anchored point.
      zoomRef.current = next;
      flushSync(() => {
        changeZoom(next);
      });
      scroller.scrollLeft = contentX * next - pointerX;
      scroller.scrollTop = contentY * next - pointerY;
    };

    // Not passive: the browser must not also scroll or zoom the page.
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      scroller.removeEventListener("wheel", onWheel);
    };
  }, [hasColumns, changeZoom]);
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

  const addImages = useAddImages(edit);
  useImageInput(addImages, view === "board" ? selectedId : null);

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
      if (settingsOpen || view !== "board") return;
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

      if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        const next = BEAT_STATUSES[(BEAT_STATUSES.indexOf(beat.status ?? "draft") + 1) % 3];
        edit((s) => updateBeat(s, beat.id, { status: next ?? "draft" }));
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
  }, [story, selectedId, dragging, edit, settingsOpen, view]);

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
  const finals = story.phases.reduce(
    (total, phase) => total + phase.beats.filter((beat) => beat.status === "final").length,
    0,
  );

  return (
    <div
      className={`board ${selected === null ? "" : "board--inspecting"}`}
      data-status-filter={statusFilter ?? undefined}
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
            {cards > 0 && (
              <>
                {" · "}
                <span className="board__progress">
                  {finals}/{cards} final
                </span>
              </>
            )}
          </p>
          <div className="view-switch" role="tablist" aria-label="View">
            <button
              type="button"
              role="tab"
              aria-selected={view === "board"}
              onClick={() => {
                changeView("board");
              }}
            >
              Board
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "lines"}
              onClick={() => {
                changeView("lines");
              }}
            >
              Lines
              {lines > 0 && <span className="view-switch__count">{lines}</span>}
            </button>
          </div>
          <div className="board__tools">
            <QuickFind story={story} onPick={pickResult} />
            {view === "board" && (
              <>
                <div className="status-filter" role="group" aria-label="Show cards">
                  {[null, ...BEAT_STATUSES].map((status) => (
                    <button
                      key={status ?? "all"}
                      type="button"
                      aria-pressed={statusFilter === status}
                      onClick={() => {
                        setStatusFilter(status);
                      }}
                    >
                      {status === null ? "All" : STATUS_NAMES[status]}
                    </button>
                  ))}
                </div>
                <div className="zoom" role="group" aria-label="Zoom">
                  <button
                    type="button"
                    aria-label="Zoom out"
                    disabled={zoom <= ZOOM_MIN}
                    onClick={() => {
                      stepZoom(-1);
                    }}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="zoom__value"
                    title="Reset zoom"
                    onClick={() => {
                      changeZoom(1);
                    }}
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                  <button
                    type="button"
                    aria-label="Zoom in"
                    disabled={zoom >= ZOOM_MAX}
                    onClick={() => {
                      stepZoom(1);
                    }}
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  className="board__tool"
                  aria-pressed={showPacing}
                  onClick={togglePacing}
                >
                  Pacing
                </button>
              </>
            )}
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

        {view === "lines" ? (
          <LinesView story={story} edit={edit} onOpenCard={openCard} />
        ) : story.phases.length === 0 ? (
          <div className="board__empty">
            <p className="board__empty-title">This story is empty</p>
            <p className="board__empty-body">
              Start with a phase, such as an act, a chapter or a level, and add cards to it. Or
              paste a whole script with <kbd className="kbd">Ctrl V</kbd> to start from your text.
            </p>
            <button
              type="button"
              className="button button--primary"
              onClick={() => {
                edit((s) => addPhase(s));
              }}
            >
              Add the first phase
            </button>
          </div>
        ) : (
          <div ref={scrollerRef} className={`board__scroller ${dragging ? "is-dragging" : ""}`}>
            <div className="board__columns" style={{ zoom }}>
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
        )}

        {view === "board" && cards > 0 && (
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
      </div>

      {view === "board" && selected !== null && (
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
          style={{ transform: `translate(${dragging.x}px, ${dragging.y}px) rotate(1.5deg)` }}
          aria-hidden="true"
        >
          {/* Same zoom as the board, so the lifted card looks like the one picked up. */}
          <div style={{ zoom, width: dragging.width / zoom }}>
            <BeatCard
              beat={draggedBeat.beat}
              number={`${draggedBeat.phaseIndex + 1}.${draggedBeat.beatIndex + 1}`}
              lookup={lookup}
            />
          </div>
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

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;
/** One wheel notch (deltaY 100) changes the zoom by about 15 %. */
const WHEEL_SENSITIVITY = 0.0015;

function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value)) * 100) / 100;
}

function readText(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeText(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembered; harmless.
  }
}
