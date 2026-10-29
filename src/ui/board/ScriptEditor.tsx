import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";

import {
  addBlock,
  ensureCharacter,
  moveBlock,
  setSoundRole,
  removeBlock,
  setBlockType,
  setLineDirection,
  setLineSpeaker,
  setLineTake,
  updateBlockText,
  type Beat,
  type Block,
  type BlockId,
  type ImageBlock,
  type MediaBlock,
  type NewBlock,
  type SoundRole,
  type Story,
  type TextBlockType,
} from "@core/model";
import { mediaArrivals } from "@app/live/project";
import { showNotice } from "@app/store";
import { useStore } from "@ui/hooks/use-store";
import { useServices } from "@ui/services/use-services";
import { AudioPlayer } from "./AudioPlayer";
import { ImageViewer } from "./ImageViewer";
import { mediaFiles, soundExtension } from "./images";
import { SfxPad } from "./SfxPad";
import { SpeakerCombo } from "./SpeakerCombo";
import { estimateSeconds } from "./story-lookup";
import { useAddImages } from "./use-images";

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

type TextBlock = Exclude<Block, MediaBlock>;

/** Drag data type for moving a block inside a card, so files dropped on it are told apart. */
const BLOCK_DRAG = "application/x-sampo-block";

const BLOCK_TYPES: readonly { type: TextBlockType; label: string }[] = [
  { type: "action", label: "Text" },
  { type: "line", label: "Line" },
  { type: "note", label: "Note" },
];

/** A card's script: prose, spoken lines with their takes, notes, pictures and sounds. */
export function ScriptEditor({
  beat,
  story,
  edit,
  autoFocus = false,
  size = "default",
}: ScriptEditorProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pendingFocus = useRef<FocusRequest | null>(null);
  // A picture or sound from a friend may land after the text: loading again shows it.
  const arrivals = useStore(mediaArrivals, (s) => s.count);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const dropMark = (index: number) =>
    dropAt === index
      ? "is-drop-before"
      : dropAt === beat.blocks.length && index === beat.blocks.length - 1
        ? "is-drop-after"
        : "";
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const takeInputRef = useRef<HTMLInputElement | null>(null);
  /** The line a picked recording belongs to, while the file dialog is open. */
  const takeFor = useRef<BlockId | null>(null);
  const [viewing, setViewing] = useState<ImageBlock | null>(null);
  const addImages = useAddImages(edit);
  const { deps } = useServices();
  const files = deps.files;

  // What the next picked sound becomes: music or an effect.
  const pickRole = useRef<SoundRole | undefined>(undefined);
  const pickFiles = (accept: string, role?: SoundRole) => {
    const input = fileInputRef.current;
    if (input === null) return;
    pickRole.current = role;
    input.accept = accept;
    input.click();
  };

  /** Packs a recording into the story and hangs it on the line. */
  const attachTake = (lineId: BlockId, file: File) => {
    const extension = soundExtension(file);
    const packed =
      extension === null
        ? Promise.reject(new Error(`${file.name} is not a sound file`))
        : files.putMedia(file, extension);
    packed.then(
      (take) => {
        edit((s) => setLineTake(s, lineId, take));
      },
      (error: unknown) => {
        showNotice(deps.notices, {
          tone: "error",
          title: "Could not attach the take",
          details: [error instanceof Error ? error.message : String(error)],
        });
      },
    );
  };
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
    block: TextBlock,
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
    } else if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      pendingFocus.current = { blockId: block.id, field: "text" };
      edit((s) => moveBlock(s, block.id, index + (event.key === "ArrowUp" ? -1 : 1)));
    } else if (event.key === "Backspace" && block.text === "" && beat.blocks.length > 1) {
      event.preventDefault();
      const neighbour = beat.blocks[index - 1] ?? beat.blocks[index + 1];
      if (neighbour !== undefined) pendingFocus.current = { blockId: neighbour.id, field: "text" };
      edit((s) => removeBlock(s, block.id));
    }
  };

  // A block's grip drags it to another place in the card; the line shows where it lands.
  const grip = (block: Block) => (
    <span
      className="script__grip"
      draggable
      title="Drag to move · Alt ↑↓ while typing"
      aria-hidden="true"
      onDragStart={(event) => {
        event.dataTransfer.setData(BLOCK_DRAG, block.id);
        event.dataTransfer.effectAllowed = "move";
        const element = event.currentTarget.closest("[data-block-id]");
        if (element !== null) event.dataTransfer.setDragImage(element, 12, 12);
      }}
      onDragEnd={() => {
        setDropAt(null);
      }}
    >
      ⠿
    </span>
  );
  const dropIndex = (event: DragEvent<HTMLElement>) => {
    const rows = [...event.currentTarget.querySelectorAll(":scope > [data-block-id]")];
    const below = rows.findIndex((row) => {
      const rect = row.getBoundingClientRect();
      return event.clientY < rect.top + rect.height / 2;
    });
    return below === -1 ? rows.length : below;
  };

  return (
    <div
      ref={rootRef}
      className={`script script--${size}`}
      onPaste={(event) => {
        const pasted = mediaFiles(event.clipboardData.files);
        if (pasted.length === 0) return;
        event.preventDefault();
        // A pasted picture lands right after the block the cursor is in.
        const at = (event.target as Element)
          .closest("[data-block-id]")
          ?.getAttribute("data-block-id");
        const index = beat.blocks.findIndex((block) => block.id === at);
        addImages(beat.id, pasted, index === -1 ? undefined : index + 1);
      }}
    >
      <div
        className="script__blocks"
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(BLOCK_DRAG)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDropAt(dropIndex(event));
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropAt(null);
        }}
        onDrop={(event) => {
          const id = event.dataTransfer.getData(BLOCK_DRAG);
          const from = beat.blocks.findIndex((block) => block.id === id);
          const moved = beat.blocks[from];
          setDropAt(null);
          if (moved === undefined) return;
          event.preventDefault();
          event.stopPropagation();
          const to = dropIndex(event);
          // Positions above count the dragged block itself; moveBlock counts without it.
          edit((s) => moveBlock(s, moved.id, to > from ? to - 1 : to));
        }}
      >
        {beat.blocks.map((block, index) =>
          block.type === "audio" ? (
            <div
              key={block.id}
              className={`script__block script__block--audio ${dropMark(index)}`}
              data-block-id={block.id}
            >
              {grip(block)}
              {block.role === "sfx" ? (
                <SfxPad
                  key={arrivals}
                  url={files.mediaUrl(block.src)}
                  label={block.text || "Effect"}
                  large={size === "large"}
                />
              ) : (
                <AudioPlayer
                  key={arrivals}
                  url={files.mediaUrl(block.src)}
                  label={block.text || "Sound"}
                />
              )}
              <div className="script__caption-row">
                <input
                  className="script__caption"
                  aria-label={block.role === "sfx" ? "Effect name" : "Sound name"}
                  placeholder={block.role === "sfx" ? "Name this effect" : "Name this sound"}
                  value={block.text}
                  onChange={(event) => {
                    const text = event.target.value;
                    edit((s) => updateBlockText(s, block.id, text), `text:${block.id}`);
                  }}
                />
                <span className="sound-role" role="group" aria-label="Kind of sound">
                  {(["music", "sfx"] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      aria-pressed={(block.role ?? "music") === kind}
                      title={
                        kind === "music"
                          ? "Music: one track at a time, with a waveform"
                          : "SFX: a pad to hit again and again"
                      }
                      onClick={() => {
                        edit((s) => setSoundRole(s, block.id, kind === "sfx" ? "sfx" : undefined));
                      }}
                    >
                      {kind === "music" ? "Music" : "SFX"}
                    </button>
                  ))}
                </span>
                <button
                  type="button"
                  className="script__tool script__tool--danger"
                  aria-label="Remove sound"
                  onClick={() => {
                    edit((s) => removeBlock(s, block.id));
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          ) : block.type === "image" ? (
            <figure
              key={block.id}
              className={`script__block script__block--image ${dropMark(index)}`}
              data-block-id={block.id}
            >
              {grip(block)}
              <button
                type="button"
                className="script__image"
                aria-label="View full size"
                onClick={() => {
                  setViewing(block);
                }}
              >
                <img
                  key={arrivals}
                  src={files.mediaUrl(block.src)}
                  alt={block.text}
                  draggable={false}
                />
              </button>
              <figcaption className="script__caption-row">
                <input
                  className="script__caption"
                  aria-label="Caption"
                  placeholder="Add a caption"
                  value={block.text}
                  onChange={(event) => {
                    const text = event.target.value;
                    edit((s) => updateBlockText(s, block.id, text), `text:${block.id}`);
                  }}
                />
                <button
                  type="button"
                  className="script__tool script__tool--danger"
                  aria-label="Remove image"
                  onClick={() => {
                    edit((s) => removeBlock(s, block.id));
                  }}
                >
                  ×
                </button>
              </figcaption>
            </figure>
          ) : (
            <div
              key={block.id}
              className={`script__block script__block--${block.type} ${dropMark(index)}`}
              data-block-id={block.id}
            >
              {grip(block)}
              {block.type !== "action" && (
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
                      <span className="script__meta-end">
                        {block.text.trim() !== "" && (
                          <span className="script__duration" title="Estimated spoken length">
                            ≈ {estimateSeconds(block.text)} s
                          </span>
                        )}
                        {block.take === undefined ? (
                          <button
                            type="button"
                            className="script__take-add"
                            title="Attach a recording of this line, scratch or final"
                            onClick={() => {
                              takeFor.current = block.id;
                              takeInputRef.current?.click();
                            }}
                          >
                            + Take
                          </button>
                        ) : (
                          <span className="script__take">
                            <AudioPlayer compact url={files.mediaUrl(block.take)} label="Take" />
                            <button
                              type="button"
                              className="script__tool script__tool--danger"
                              aria-label="Remove take"
                              title="Remove take"
                              onClick={() => {
                                edit((s) => setLineTake(s, block.id, null));
                              }}
                            >
                              ×
                            </button>
                          </span>
                        )}
                      </span>
                    </>
                  ) : (
                    <span className="script__kind">Note</span>
                  )}
                </div>
              )}
              {/* Floats over the block's corner on hover, so the script reads clean at rest. */}
              <span className="script__tools" role="toolbar" aria-label="Block tools">
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
                  title="Remove"
                  onClick={() => {
                    edit((s) => removeBlock(s, block.id));
                  }}
                >
                  ×
                </button>
              </span>
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
          ),
        )}
      </div>

      {/* Writing on the left, media on the right: two kinds of adding, two groups. */}
      <div className="script__add">
        <span className="script__add-group" role="group" aria-label="Add writing">
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
        </span>
        <span className="script__add-group" role="group" aria-label="Add media">
          <button
            type="button"
            title="Or paste (Ctrl V) or drop a picture onto the card"
            onClick={() => {
              pickFiles("image/*");
            }}
          >
            + Image
          </button>
          <button
            type="button"
            title="A track to play through, one at a time, with a waveform. Or drop a sound file onto the card"
            onClick={() => {
              pickFiles("audio/*");
            }}
          >
            + Music
          </button>
          <button
            type="button"
            title="A sound effect as a soundboard pad: hit it as often as you like, each hit starts it over"
            onClick={() => {
              pickFiles("audio/*", "sfx");
            }}
          >
            + SFX
          </button>
        </span>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            addImages(beat.id, mediaFiles(event.target.files), undefined, pickRole.current);
            event.target.value = "";
          }}
        />
        <input
          ref={takeInputRef}
          type="file"
          accept="audio/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            const lineId = takeFor.current;
            event.target.value = "";
            if (file !== undefined && lineId !== null) attachTake(lineId, file);
          }}
        />
      </div>
      <p className="script__hint">Ctrl ↵ next line · Alt 1–9 speaker · Ctrl V image</p>

      {viewing !== null && (
        <ImageViewer
          src={files.mediaUrl(viewing.src)}
          caption={viewing.text}
          onClose={() => {
            setViewing(null);
          }}
        />
      )}
    </div>
  );
}
