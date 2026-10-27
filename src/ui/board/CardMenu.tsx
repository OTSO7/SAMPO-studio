import { useEffect, useRef } from "react";

interface CardMenuProps {
  x: number;
  y: number;
  expanded: boolean;
  onOpen: () => void;
  onToggleExpand: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}

/** The right-click menu on a card: the everyday card actions, where the pointer already is. */
export function CardMenu({
  x,
  y,
  expanded,
  onOpen,
  onToggleExpand,
  onDuplicate,
  onDelete,
  onClose,
}: CardMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ref.current?.querySelector("button")?.focus();
    const close = (event: Event) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === "Escape"
          : !ref.current?.contains(event.target as Node)
      ) {
        onClose();
      }
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    window.addEventListener("wheel", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
      window.removeEventListener("wheel", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const act = (action: () => void) => () => {
    action();
    onClose();
  };

  // Kept inside the window near its right and bottom edges.
  const style = {
    left: Math.min(x, window.innerWidth - 200),
    top: Math.min(y, window.innerHeight - 180),
  };

  return (
    <div ref={ref} className="card-menu menu__list" role="menu" style={style}>
      <button type="button" role="menuitem" className="menu__item" onClick={act(onOpen)}>
        Open
      </button>
      <button type="button" role="menuitem" className="menu__item" onClick={act(onToggleExpand)}>
        {expanded ? "Collapse" : "Expand"}
        <span className="menu__hint">
          {expanded ? "Show a preview again" : "Show the whole card"}
        </span>
      </button>
      <button type="button" role="menuitem" className="menu__item" onClick={act(onDuplicate)}>
        Duplicate
      </button>
      <button
        type="button"
        role="menuitem"
        className="menu__item menu__item--danger"
        onClick={act(onDelete)}
      >
        Delete
      </button>
    </div>
  );
}
