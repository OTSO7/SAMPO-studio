import "./primitives.css";

/** A key combination such as Ctrl + S, one cap per key. */
export function Kbd({ keys }: { keys: readonly string[] }) {
  return (
    <span className="kbd-combo">
      {keys.map((key) => (
        <kbd key={key} className="kbd">
          {key}
        </kbd>
      ))}
    </span>
  );
}
