import { useEffect, useRef, type KeyboardEvent } from "react";

import {
  addBlock,
  ensureCharacter,
  removeBlock,
  setBlockType,
  setLineDirection,
  setLineSpeaker,
  updateBlockText,
  type Beat,
  type Block,
  type BlockId,
  type NewBlock,
  type Story,
} from "@core/model";
import { SpeakerCombo } from "./SpeakerCombo";
import { estimateSeconds } from "./story-lookup";

interface ScriptEditorProps {
  beat: Beat;
  story: Story;
  edit: (recipe: (story: Story) => Story, group?: string) => void;
  /** Put the cursor in the first block when the editor appears. */
  autoFocus?: boolean;
  /** Larger type for presenting. */
  size?: "default" | "large";
}

interface FocusRequest {
  readonly blockId: BlockId;
  readonly field: "speaker" | "text";
}

const BLOCK_TYPES: readonly { type: Block["type"]; label: string }[] = [
  { type: "action", label: "Text" },
  { type: "line", label: "Line" },
  { type: "note", label: "Note" },
];

/** A card's script: prose, spoken lines with speaker and direction, and notes. */
export function ScriptEditor({
  beat,
  story,
  edit,
  autoFocus = false,
  size = "default",
}: ScriptEditorProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pendingFocus = useRef<FocusRequest | null>(null);
  const characters = story.entities.filter((entity) => entity.kind === "character");

  const focusBlock = (request: FocusRequest) => {
    const selector = request.field === "speaker" ? ".speaker__input" : "textarea.script__text";
    rootRef.current
      ?.querySelector<HTMLElement>(`[data-block-id="${request.blockId}"] ${selector}`)
      ?.focus();
  };

  // A block created by the last edit gets focus once it has rendered.
  useEffect(() => {
    if (pendingFocus.current === null) return;
    focusBlock(pendingFocus.current);
    pendingFocus.current = null;
  });

  useEffect(() => {
    const first = beat.blocks[0];
    if (!autoFocus || first === undefined) return;
    focusBlock({
      blockId: first.id,
      field: first.type === "line" && first.speaker === null ? "speaker" : "text",
    });
    // Only when the editor first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const insert = (block: NewBlock, index?: number) => {
    edit((current) => {
      const result = addBlock(current, beat.id, block, index);
      if (result.blockId !== null) {
        pendingFocus.current = {
          blockId: result.blockId,
          field: block.type === "line" && block.speaker === null ? "speaker" : "text",
        };
      }
      return result.story;
    });
  };

  /** In dialogue, the next line goes to whoever spoke before the current speaker. */
  const nextSpeaker = (index: number) => {
    const current = beat.blocks[index];
    const currentSpeaker = current?.type === "line" ? current.speaker : null;
    const previous = beat.blocks
      .slice(0, index)
      .reverse()
      .find((block) => block.type === "line" && block.speaker !== currentSpeaker);
    return previous?.type === "line" ? previous.speaker : currentSpeaker;
  };

  const onTextKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
    block: Block,
    index: number,
  ) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      insert(
        block.type === "line"
          ? { type: "line", speaker: nextSpeaker(index) }
          : { type: block.type },
        index + 1,
      );
    } else if (event.altKey && /^[1-9]$/u.test(event.key) && block.type === "line") {
      const character = characters[Number(event.key) - 1];
      if (character !== undefined) {
        event.preventDefault();
        edit((s) => setLineSpeaker(s, block.id, character.id));
      }
    } else if (event.key === "Backspace" && block.text === "" && beat.blocks.length > 1) {
      event.preventDefault();
      const neighbour = beat.blocks[index - 1] ?? beat.blocks[index + 1];
      if (neighbour !== undefined) pendingFocus.current = { blockId: neighbour.id, field: "text" };
      edit((s) => removeBlock(s, block.id));
    }
  };

  return (
    <div ref={rootRef} className={`script script--${size}`}>
      <div className="script__blocks">
        {beat.blocks.map((block, index) => (
          <div
            key={block.id}
            className={`script__block script__block--${block.type}`}
            data-block-id={block.id}
          >
            <div className="script__meta">
              {block.type === "line" ? (
                <>
                  <SpeakerCombo
                    value={block.speaker}
                    characters={characters}
                    onSelect={(speaker) => {
                      edit((s) => setLineSpeaker(s, block.id, speaker));
                    }}
                    onCreate={(name) => {
                      edit((s) => {
                        const { story: withCharacter, entityId } = ensureCharacter(s, name);
                        return setLineSpeaker(withCharacter, block.id, entityId);
                      });
                    }}
                    onDone={() => {
                      pendingFocus.current = { blockId: block.id, field: "text" };
                    }}
                  />
                  <input
                    className="script__direction"
                    aria-label="Direction"
                    placeholder="(direction)"
                    value={block.direction ?? ""}
                    onChange={(event) => {
                      const direction = event.target.value;
                      edit(
                        (s) => setLineDirection(s, block.id, direction),
                        `direction:${block.id}`,
                      );
                    }}
                  />
                </>
              ) : (
                <span className="script__kind">{block.type === "note" ? "Note" : "Text"}</span>
              )}
              <span className="script__tools">
                {block.type === "line" && block.text.trim() !== "" && (
                  <span className="script__duration" title="Estimated spoken length">
                    ≈ {estimateSeconds(block.text)} s
                  </span>
                )}
                {BLOCK_TYPES.filter((option) => option.type !== block.type).map((option) => (
                  <button
                    key={option.type}
                    type="button"
                    className="script__tool"
                    onClick={() => {
                      edit((s) => setBlockType(s, block.id, option.type));
                    }}
                  >
                    → {option.label}
                  </button>
                ))}
                <button
                  type="button"
                  className="script__tool script__tool--danger"
                  aria-label="Remove"
                  onClick={() => {
                    edit((s) => removeBlock(s, block.id));
                  }}
                >
                  ×
                </button>
              </span>
            </div>
            <textarea
              data-autofocus={index === 0 ? "" : undefined}
              className="script__text"
              value={block.text}
              placeholder={
                block.type === "line"
                  ? "What do they say?"
                  : block.type === "note"
                    ? "Idea or open question"
                    : "What happens?"
              }
              onChange={(event) => {
                const text = event.target.value;
                edit((s) => updateBlockText(s, block.id, text), `text:${block.id}`);
              }}
              onKeyDown={(event) => {
                onTextKeyDown(event, block, index);
              }}
            />
          </div>
        ))}
      </div>

      <div className="script__add">
        <button
          type="button"
          onClick={() => {
            insert({ type: "action" });
          }}
        >
          + Text
        </button>
        <button
          type="button"
          onClick={() => {
            insert({ type: "line", speaker: nextSpeaker(beat.blocks.length) });
          }}
        >
          + Line
        </button>
        <button
          type="button"
          onClick={() => {
            insert({ type: "note" });
          }}
        >
          + Note
        </button>
        <span className="script__hint">Ctrl ↵ next line · Alt 1–9 speaker</span>
      </div>
    </div>
  );
}
