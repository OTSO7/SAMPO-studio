import { useId } from "react";

/**
 * One sound effect's own level, to even out loud and quiet files. Goes up to 200%; the mark is at
 * 100%, the file as it is, and a double click returns there.
 */
export function SfxOwnVolume({
  label,
  volume,
  onChange,
}: {
  label: string;
  volume: number;
  onChange: (volume: number) => void;
}) {
  const marks = useId();
  const percent = Math.round(volume * 100);
  return (
    <label className="sfx-own" title="This effect's volume. Double-click to reset to 100%.">
      <input
        type="range"
        min={0}
        max={200}
        step={5}
        value={percent}
        list={marks}
        aria-label={`Volume of ${label}`}
        aria-valuetext={`${percent} percent`}
        onChange={(event) => {
          onChange(Number(event.target.value) / 100);
        }}
        onDoubleClick={() => {
          onChange(1);
        }}
      />
      <datalist id={marks}>
        <option value={100} />
      </datalist>
      <span className={`sfx-own__value ${percent > 100 ? "is-boosted" : ""}`}>{percent}%</span>
    </label>
  );
}
