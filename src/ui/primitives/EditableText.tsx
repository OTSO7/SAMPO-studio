import { useState } from "react";

interface EditableTextProps {
  value: string;
  placeholder?: string;
  className?: string;
  label: string;
  onCommit: (value: string) => void;
}

/** Text that turns into an input on click. Enter or blur saves, Escape cancels. */
export function EditableText({
  value,
  placeholder,
  className,
  label,
  onCommit,
}: EditableTextProps) {
  const [draft, setDraft] = useState<string | null>(null);

  if (draft === null) {
    return (
      <button
        type="button"
        className={`editable ${value === "" ? "editable--empty" : ""} ${className ?? ""}`}
        aria-label={`Edit ${label}`}
        onClick={() => {
          setDraft(value);
        }}
      >
        {value === "" ? placeholder : value}
      </button>
    );
  }

  const finish = (save: boolean) => {
    if (save && draft.trim() !== value) onCommit(draft.trim());
    setDraft(null);
  };

  return (
    <input
      autoFocus
      className={`editable editable--editing ${className ?? ""}`}
      aria-label={label}
      value={draft}
      placeholder={placeholder}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onFocus={(event) => {
        event.target.select();
      }}
      onBlur={() => {
        finish(true);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") finish(true);
        if (event.key === "Escape") finish(false);
      }}
    />
  );
}
