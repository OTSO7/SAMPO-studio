import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import type { BeatId, PhaseId } from "@core/model";

export interface DropTarget {
  readonly phaseId: PhaseId;
  /** Position among the phase's cards, not counting the card being dragged. */
  readonly index: number;
}

/** Drop onto the "+ Phase" spot: the card moves into a new phase made for it. */
export const NEW_PHASE = "new-phase" as PhaseId;

export interface DragState {
  readonly beatId: BeatId;
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
}

interface Session {
  readonly beatId: BeatId;
  readonly startX: number;
  readonly startY: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
  active: boolean;
  target: DropTarget | null;
}

const DRAG_THRESHOLD = 5;
const EDGE = 72;
const SCROLL_STEP = 18;

/**
 * Pointer-driven card dragging. The board marks columns with `data-phase-id` and cards with
 * `data-beat-id`; this hook finds the drop position from those and leaves the move itself
 * to `onDrop`. A press without movement stays a normal click.
 */
export function useCardDrag(
  scrollerRef: RefObject<HTMLElement | null>,
  onDrop: (beatId: BeatId, target: DropTarget) => void,
) {
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const session = useRef<Session | null>(null);
  const suppressClick = useRef(false);
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanup.current?.(), []);

  const findTarget = useCallback(
    (x: number, y: number, beatId: BeatId): DropTarget | null => {
      const scroller = scrollerRef.current;
      if (scroller === null) return null;

      const spot = scroller.querySelector<HTMLElement>("[data-new-phase]")?.getBoundingClientRect();
      if (spot !== undefined && x >= spot.left && x <= spot.right)
        return { phaseId: NEW_PHASE, index: 0 };

      let best: { element: HTMLElement; distance: number } | null = null;
      for (const column of scroller.querySelectorAll<HTMLElement>("[data-phase-id]")) {
        const rect = column.getBoundingClientRect();
        const distance = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
        if (best === null || distance < best.distance) best = { element: column, distance };
      }
      if (best === null) return null;

      const phaseId = best.element.dataset["phaseId"] as PhaseId;
      let index = 0;
      for (const card of best.element.querySelectorAll<HTMLElement>("[data-beat-id]")) {
        if (card.dataset["beatId"] === beatId) continue;
        const rect = card.getBoundingClientRect();
        if (y > rect.top + rect.height / 2) index++;
      }
      return { phaseId, index };
    },
    [scrollerRef],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, beatId: BeatId, origin: DropTarget) => {
      if (event.button !== 0) return;
      const rect = event.currentTarget.getBoundingClientRect();
      session.current = {
        beatId,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        width: rect.width,
        height: rect.height,
        active: false,
        target: origin,
      };

      const finish = (commit: boolean) => {
        const current = session.current;
        if (current?.active) {
          suppressClick.current = true;
          setTimeout(() => {
            suppressClick.current = false;
          }, 0);
          if (commit && current.target !== null) onDrop(current.beatId, current.target);
        }
        session.current = null;
        setDragging(null);
        setDropTarget(null);
        cleanup.current?.();
      };

      const move = (e: PointerEvent) => {
        const current = session.current;
        if (current === null) return;

        if (!current.active) {
          if (Math.hypot(e.clientX - current.startX, e.clientY - current.startY) < DRAG_THRESHOLD) {
            return;
          }
          current.active = true;
          setDropTarget(current.target);
        }

        const x = e.clientX - current.offsetX;
        const y = e.clientY - current.offsetY;
        setDragging((state) =>
          state === null
            ? { beatId: current.beatId, width: current.width, height: current.height, x, y }
            : state,
        );
        if (ghostRef.current !== null) {
          ghostRef.current.style.transform = `translate(${x}px, ${y}px) rotate(1.5deg)`;
        }

        const scroller = scrollerRef.current;
        if (scroller !== null) {
          const bounds = scroller.getBoundingClientRect();
          if (e.clientX > bounds.right - EDGE) scroller.scrollLeft += SCROLL_STEP;
          else if (e.clientX < bounds.left + EDGE) scroller.scrollLeft -= SCROLL_STEP;
        }

        const target = findTarget(e.clientX, e.clientY, current.beatId);
        if (
          target !== null &&
          (target.phaseId !== current.target?.phaseId || target.index !== current.target.index)
        ) {
          current.target = target;
          setDropTarget(target);
        }
      };

      const up = () => {
        finish(true);
      };
      const key = (e: KeyboardEvent) => {
        if (e.key === "Escape" && session.current?.active) {
          e.preventDefault();
          e.stopImmediatePropagation();
          finish(false);
        }
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("keydown", key, true);
      cleanup.current = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("keydown", key, true);
        cleanup.current = null;
      };
    },
    [findTarget, onDrop, scrollerRef],
  );

  /** True right after a drag ended, so the click that follows it can be ignored. */
  const consumeClick = useCallback(() => suppressClick.current, []);

  return { dragging, dropTarget, ghostRef, onPointerDown, consumeClick };
}
