import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { updateBeat, type BeatId, type Intensity, type Story } from "@core/model";
import { INTENSITY_NAMES } from "./intensity";

interface PacingStripProps {
  story: Story;
  selectedBeatId: BeatId | null;
  edit: (recipe: (story: Story) => Story, group?: string) => void;
  onSelect: (beatId: BeatId) => void;
}

const PAD_X = 28;
const PAD_TOP = 26;
const PAD_BOTTOM = 14;
const MIN_PLOT = 24;
const MAX: Intensity = 5;

interface Point {
  readonly beatId: BeatId;
  readonly phaseIndex: number;
  readonly label: string;
  readonly intensity: Intensity | undefined;
  readonly x: number;
}

/**
 * The story's rhythm at a glance: one point per card, tension on the vertical axis.
 * Drag a point up or down to set its tension; click it to open the card.
 */
export function PacingStrip({ story, selectedBeatId, edit, onSelect }: PacingStripProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState({ width: 800, height: 120 });
  const [dragging, setDragging] = useState<BeatId | null>(null);

  // The chart fills its box and redraws at the new size whenever the panel is resized.
  useEffect(() => {
    const element = boxRef.current;
    if (element === null) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      setSize({
        width: Math.max(200, entry.contentRect.width),
        height: Math.max(PAD_TOP + PAD_BOTTOM + MIN_PLOT, entry.contentRect.height),
      });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const { width, height } = size;
  const plot = height - PAD_TOP - PAD_BOTTOM;
  const yFor = (level: number) => PAD_TOP + ((MAX - level) / MAX) * plot;

  const cards = story.phases.flatMap((phase, phaseIndex) =>
    phase.beats.map((beat, beatIndex) => ({ beat, phaseIndex, beatIndex })),
  );
  const step = cards.length > 1 ? (width - PAD_X * 2) / (cards.length - 1) : 0;
  const points: Point[] = cards.map(({ beat, phaseIndex, beatIndex }, index) => ({
    beatId: beat.id,
    phaseIndex,
    label: `${phaseIndex + 1}.${beatIndex + 1}${beat.label === undefined ? "" : ` ${beat.label}`}`,
    intensity: beat.intensity,
    x: cards.length > 1 ? PAD_X + index * step : width / 2,
  }));

  // The line connects runs of cards that have a tension set and breaks at the gaps.
  const segments: string[] = [];
  let current = "";
  for (const point of points) {
    if (point.intensity === undefined) {
      if (current !== "") segments.push(current);
      current = "";
    } else {
      current += `${current === "" ? "M" : " L"}${point.x.toFixed(1)},${yFor(point.intensity).toFixed(1)}`;
    }
  }
  if (current !== "") segments.push(current);

  const phaseStarts = points.filter(
    (point, index) => index === 0 || points[index - 1]?.phaseIndex !== point.phaseIndex,
  );

  const levelAt = (clientY: number): Intensity => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (rect === undefined) return 0;
    const ratio = (clientY - rect.top - PAD_TOP) / plot;
    return Math.max(0, Math.min(MAX, Math.round(MAX - ratio * MAX))) as Intensity;
  };

  const startDrag = (event: ReactPointerEvent<SVGElement>, point: Point) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startY = event.clientY;
    let moved = false;
    setDragging(point.beatId);

    const move = (e: PointerEvent) => {
      if (!moved && Math.abs(e.clientY - startY) < 3) return;
      moved = true;
      const level = levelAt(e.clientY);
      edit((s) => updateBeat(s, point.beatId, { intensity: level }), `tension:${point.beatId}`);
    };
    const up = () => {
      if (!moved) onSelect(point.beatId);
      setDragging(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div ref={boxRef} className="pacing__box">
      <svg
        ref={svgRef}
        className={`pacing__chart ${dragging === null ? "" : "is-dragging"}`}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Tension across the story"
      >
        {[0, 1, 2, 3, 4, 5].map((level) => (
          <line
            key={level}
            className="pacing__grid"
            x1={PAD_X / 2}
            x2={width - PAD_X / 2}
            y1={yFor(level)}
            y2={yFor(level)}
          />
        ))}

        {phaseStarts.map((point) => (
          <g key={`phase-${point.phaseIndex}`}>
            {point.phaseIndex > 0 && (
              <line
                className="pacing__phase"
                x1={point.x - step / 2}
                x2={point.x - step / 2}
                y1={PAD_TOP - 18}
                y2={height - PAD_BOTTOM}
              />
            )}
            <text
              className="pacing__phase-label"
              x={point.x - (point.phaseIndex > 0 ? step / 2 - 6 : 0)}
              y={PAD_TOP - 10}
            >
              {String(point.phaseIndex + 1).padStart(2, "0")}
            </text>
          </g>
        ))}

        {segments.map((d) => (
          <path key={d} className="pacing__line" d={d} />
        ))}

        {points.map((point) => {
          const set = point.intensity !== undefined;
          const y = yFor(point.intensity ?? 0);
          return (
            <g
              key={point.beatId}
              className={`pacing__point ${set ? "" : "is-unset"} ${point.beatId === selectedBeatId ? "is-selected" : ""}`}
              onPointerDown={(event) => {
                startDrag(event, point);
              }}
            >
              <title>
                {point.label} — {set ? INTENSITY_NAMES[point.intensity ?? 0] : "No tension set"}
              </title>
              <rect
                className="pacing__hit"
                x={point.x - Math.max(6, step / 2)}
                y={PAD_TOP - 6}
                width={Math.max(12, step)}
                height={plot + 12}
              />
              <circle cx={point.x} cy={y} r={set ? 4 : 2.5} />
            </g>
          );
        })}
      </svg>
      <div className="pacing__legend" aria-hidden="true">
        <span>Peak</span>
        <span>Calm</span>
      </div>
    </div>
  );
}
