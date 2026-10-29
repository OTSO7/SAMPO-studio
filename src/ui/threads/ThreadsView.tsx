import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import {
  ensureThread,
  removeEntity,
  threadRuns,
  updateEntity,
  type Beat,
  type BeatId,
  type EntityId,
  type Story,
} from "@core/model";
import { SpeakerCombo } from "@ui/board/SpeakerCombo";
import { EditableText } from "@ui/primitives/EditableText";

import "./threads.css";

interface ThreadsViewProps {
  story: Story;
  edit: (recipe: (story: Story) => Story, group?: string) => void;
  /** The board's zoom, shared so both views keep the scale the author set. */
  zoom: number;
  onOpenCard: (beatId: BeatId) => void;
}

interface Rect {
  readonly left: number;
  readonly right: number;
  readonly top: number;
}

/** What a card is about, in a line or two: its heading, or else how it opens. */
function summary(beat: Beat): string {
  if (beat.label !== undefined) return beat.label;
  const first = beat.blocks.find((block) => block.text.trim() !== "");
  return first?.text ?? "Empty card";
}

/** Strings meet a card on its side, a little below the top, where the pin is. */
const PIN_Y = 22;

/** A string sagging from one pinned card to the next, through the gap between columns. */
function stringPath(from: Rect, to: Rect): string {
  const sameColumn = Math.abs(from.left - to.left) < 4;
  const startX = from.right;
  const startY = from.top + PIN_Y;
  const endX = sameColumn ? to.right : to.left;
  const endY = to.top + PIN_Y;
  if (sameColumn) {
    // Cards above each other: the string loops out into the gap on the right.
    const out = 40 + Math.min(40, Math.abs(endY - startY) / 6);
    return `M ${startX} ${startY} C ${startX + out} ${startY}, ${endX + out} ${endY}, ${endX} ${endY}`;
  }
  const reach = Math.max(36, (endX - startX) / 2);
  const sag = 18 + Math.abs(endY - startY) / 10;
  return `M ${startX} ${startY} C ${startX + reach} ${startY + sag}, ${endX - reach} ${endY + sag}, ${endX} ${endY}`;
}

/**
 * The detective's wall: only the cards that carry a thread, pinned up in story order, with a
 * coloured string for every thread running between them. Where strings meet on one card the
 * story ties together. Pick a thread to follow it; point at a card to see all it connects.
 */
export function ThreadsView({ story, edit, zoom, onOpenCard }: ThreadsViewProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState<EntityId | null>(null);
  const [hoverThread, setHoverThread] = useState<EntityId | null>(null);
  const [hoverCard, setHoverCard] = useState<BeatId | null>(null);
  const [rects, setRects] = useState<ReadonlyMap<string, Rect>>(new Map());
  const [size, setSize] = useState({ width: 0, height: 0 });

  const runs = useMemo(() => {
    const order = new Map(
      story.phases.flatMap((phase) => phase.beats).map((beat, index) => [beat.id, index]),
    );
    return threadRuns(story).sort(
      (a, b) =>
        (order.get(a.cards[0]?.beatId as BeatId) ?? Infinity) -
        (order.get(b.cards[0]?.beatId as BeatId) ?? Infinity),
    );
  }, [story]);
  const threadById = useMemo(() => new Map(runs.map((run) => [run.thread.id, run.thread])), [runs]);

  // Only phases and cards that carry a thread are pinned to the wall.
  const columns = useMemo(
    () =>
      story.phases
        .map((phase, phaseIndex) => ({
          phase,
          number: phaseIndex + 1,
          cards: phase.beats.flatMap((beat, beatIndex) =>
            (beat.threads?.length ?? 0) > 0
              ? [{ beat, number: `${phaseIndex + 1}.${beatIndex + 1}` }]
              : [],
          ),
        }))
        .filter((column) => column.cards.length > 0),
    [story.phases],
  );

  // A thread chosen in the list wins; otherwise the one under the pointer lights up.
  const active = focused ?? hoverThread;
  const cardThreads = (beat: Beat) => beat.threads ?? [];
  const lit = (beat: Beat) =>
    hoverCard === beat.id || active === null || cardThreads(beat).includes(active);
  /** The threads of the card under the pointer, which the list lights up by name. */
  const hoveredThreads = useMemo(() => {
    const beat = story.phases.flatMap((phase) => phase.beats).find((b) => b.id === hoverCard);
    return beat === undefined ? null : new Set(cardThreads(beat));
  }, [story.phases, hoverCard]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;
    const measure = () => {
      const next = new Map<string, Rect>();
      // Layout boxes in the canvas's own (unzoomed) units, not the tilted visual ones, so
      // strings meet the pins at any zoom.
      canvas.querySelectorAll<HTMLElement>("[data-pinned-card]").forEach((card) => {
        next.set(card.dataset["pinnedCard"] ?? "", {
          left: card.offsetLeft,
          right: card.offsetLeft + card.offsetWidth,
          top: card.offsetTop,
        });
      });
      setRects(next);
      setSize({ width: canvas.offsetWidth, height: canvas.offsetHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
    };
  }, [columns]);

  const open = runs.filter((run) => run.cards.length === 1).length;

  return (
    <div className="corkboard">
      <aside className="corkboard__threads" aria-label="Story threads">
        <p className="corkboard__counts">
          <strong>{runs.length}</strong> {runs.length === 1 ? "thread" : "threads"}
          {open > 0 && (
            <span className="corkboard__open-count">
              {" · "}
              <strong>{open}</strong> open
            </span>
          )}
        </p>
        <ul className="corkboard__list">
          {runs.map(({ thread, cards }) => {
            const isOpen = cards.length === 1;
            const span =
              cards.length === 0
                ? "No cards yet"
                : isOpen
                  ? `Only in ${cards[0]?.number ?? ""}`
                  : `${cards[0]?.number ?? ""} → ${cards.at(-1)?.number ?? ""} · ${cards.length} cards`;
            return (
              <li
                key={thread.id}
                className={`corkboard__thread ${focused === thread.id ? "is-focused" : ""} ${
                  hoveredThreads !== null
                    ? hoveredThreads.has(thread.id)
                      ? "is-lit"
                      : "is-faded"
                    : active !== null && active !== thread.id
                      ? "is-faded"
                      : ""
                }`}
                data-swatch={thread.color ?? "rose"}
                onMouseEnter={() => {
                  setHoverThread(thread.id);
                }}
                onMouseLeave={() => {
                  setHoverThread(null);
                }}
                // A click anywhere on the row keeps the thread lit after the pointer leaves;
                // the name, follow dot and delete keep their own clicks.
                onClick={(event) => {
                  if ((event.target as Element).closest("button, input, textarea") !== null) return;
                  setFocused(focused === thread.id ? null : thread.id);
                }}
              >
                <button
                  type="button"
                  className="corkboard__follow"
                  aria-pressed={focused === thread.id}
                  aria-label={`Follow ${thread.name}`}
                  title={focused === thread.id ? "Stop following" : "Follow this thread"}
                  onClick={() => {
                    setFocused(focused === thread.id ? null : thread.id);
                  }}
                >
                  <span className="corkboard__dot" aria-hidden="true" />
                </button>
                <span className="corkboard__thread-body">
                  <EditableText
                    className="corkboard__thread-name"
                    label="thread name"
                    value={thread.name}
                    onCommit={(name) => {
                      if (name.trim() !== "") edit((s) => updateEntity(s, thread.id, { name }));
                    }}
                  />
                  <span className="corkboard__span">{span}</span>
                </span>
                {isOpen && (
                  <span className="corkboard__badge" title="Set up but never paid off">
                    Open
                  </span>
                )}
                <button
                  type="button"
                  className="corkboard__remove"
                  aria-label={`Delete thread ${thread.name}`}
                  title="Delete thread"
                  onClick={() => {
                    if (focused === thread.id) setFocused(null);
                    edit((s) => removeEntity(s, thread.id));
                  }}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
        <div className="corkboard__new">
          <SpeakerCombo
            value={null}
            characters={[]}
            label="Start a story thread"
            placeholder="+ New thread"
            noun="thread"
            onSelect={() => undefined}
            onCreate={(name) => {
              edit((s) => ensureThread(s, name).story);
            }}
          />
        </div>
        <p className="corkboard__help">
          Pin a card to a thread from the card&apos;s Threads row. Open threads were set up and
          never paid off.
        </p>
      </aside>

      {columns.length === 0 ? (
        <div className="corkboard__empty">
          <p className="corkboard__empty-title">Nothing on the wall yet</p>
          <p className="corkboard__empty-body">
            Open a card on the board and add a thread in its Threads row: the key in the
            keeper&apos;s pocket, who put out the light. Every card you pin appears here, joined to
            the others by its thread.
          </p>
        </div>
      ) : (
        <div className="corkboard__wall">
          <div className="corkboard__canvas" ref={canvasRef} style={{ zoom }}>
            <svg
              className="corkboard__strings"
              width={size.width}
              height={size.height}
              aria-hidden="true"
            >
              {runs.map(({ thread, cards }) => {
                const points = cards.flatMap((card) => {
                  const rect = rects.get(card.beatId);
                  return rect === undefined ? [] : [rect];
                });
                const touchesHovered =
                  hoverCard !== null && cards.some((card) => card.beatId === hoverCard);
                const state =
                  touchesHovered || active === thread.id
                    ? "is-lit"
                    : active !== null || hoverCard !== null
                      ? "is-faded"
                      : "";
                // An open thread has no string: its single pin and the list's Open badge say it.
                return (
                  <g
                    key={thread.id}
                    className={`corkboard__string ${state}`}
                    data-swatch={thread.color ?? "rose"}
                  >
                    {points.slice(1).map((to, index) => {
                      const from = points[index];
                      return from === undefined ? null : (
                        <path key={index} d={stringPath(from, to)} />
                      );
                    })}
                  </g>
                );
              })}
            </svg>

            {columns.map(({ phase, number, cards }) => (
              <section key={phase.id} className="corkboard__column" aria-label={phase.title}>
                <header className="corkboard__phase">
                  <span className="corkboard__phase-number">{String(number).padStart(2, "0")}</span>
                  {phase.title}
                </header>
                {cards.map(({ beat, number: cardNumber }, index) => (
                  <button
                    key={beat.id}
                    type="button"
                    data-pinned-card={beat.id}
                    className={`corkboard__card ${lit(beat) ? "" : "is-faded"} ${
                      hoverCard === beat.id ? "is-hub" : ""
                    }`}
                    // A slight, stable tilt per card: pinned by hand, not printed on a grid.
                    style={
                      { "--tilt": `${((index * 7 + number * 3) % 5) - 2}deg` } as CSSProperties
                    }
                    title="Open the card"
                    onMouseEnter={() => {
                      setHoverCard(beat.id);
                    }}
                    onMouseLeave={() => {
                      setHoverCard(null);
                    }}
                    onClick={() => {
                      onOpenCard(beat.id);
                    }}
                  >
                    <span className="corkboard__card-head">
                      <span className="corkboard__card-number">{cardNumber}</span>
                      <span className="corkboard__pins">
                        {cardThreads(beat).map((threadId) => (
                          <span
                            key={threadId}
                            className="corkboard__pin"
                            data-swatch={threadById.get(threadId)?.color ?? "rose"}
                          />
                        ))}
                      </span>
                    </span>
                    <span className="corkboard__card-text">{summary(beat)}</span>
                    {/* Colours repeat; names do not. Pointing at a card says which threads run here. */}
                    <span className="corkboard__tag" aria-hidden="true">
                      {cardThreads(beat).map((threadId) => {
                        const thread = threadById.get(threadId);
                        return (
                          <span
                            key={threadId}
                            className="corkboard__tag-item"
                            data-swatch={thread?.color ?? "rose"}
                          >
                            <span className="swatch-dot" />
                            {thread?.name}
                          </span>
                        );
                      })}
                    </span>
                  </button>
                ))}
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
