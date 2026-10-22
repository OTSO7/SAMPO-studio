import type { Block, TextBlockType } from "./block";
import type { Entity } from "./entity";
import { defaultCardType } from "./factories";
import {
  newId,
  type BeatId,
  type BlockId,
  type CardTypeId,
  type EntityId,
  type IdFactory,
  type PhaseId,
} from "./ids";
import { nextSwatch, type Swatch } from "./palette";
import type { Beat, BeatStatus, CardType, Intensity, Phase, Story } from "./story";

/*
 * Story edits as pure functions: each returns a new story and leaves the input untouched,
 * which is what makes undo a matter of keeping the previous value. Edits that cannot apply
 * (an unknown id, nothing to merge with) return the story unchanged rather than throwing.
 */

export interface BeatLocation {
  readonly phaseIndex: number;
  readonly beatIndex: number;
  readonly phase: Phase;
  readonly beat: Beat;
}

export function findBeat(story: Story, beatId: BeatId): BeatLocation | null {
  for (const [phaseIndex, phase] of story.phases.entries()) {
    const beatIndex = phase.beats.findIndex((beat) => beat.id === beatId);
    const beat = phase.beats[beatIndex];
    if (beat !== undefined) return { phaseIndex, beatIndex, phase, beat };
  }
  return null;
}

export function setStoryTitle(story: Story, title: string): Story {
  return { ...story, title };
}

export function updatePhase(
  story: Story,
  phaseId: PhaseId,
  patch: { readonly title?: string; readonly location?: string },
): Story {
  return mapPhases(story, (phase) => {
    if (phase.id !== phaseId) return phase;
    const next: Phase = { ...phase, ...(patch.title === undefined ? {} : { title: patch.title }) };
    if (patch.location === undefined) return next;
    const { location: _old, ...rest } = next;
    return patch.location.trim() === "" ? rest : { ...rest, location: patch.location };
  });
}

export interface BeatPatch {
  readonly typeId?: CardTypeId;
  /** An empty string removes the label. */
  readonly label?: string;
  /** `null` removes the intensity. */
  readonly intensity?: Intensity | null;
  readonly status?: BeatStatus;
}

export function updateBeat(story: Story, beatId: BeatId, patch: BeatPatch): Story {
  return mapBeats(story, (beat) => {
    if (beat.id !== beatId) return beat;
    const { label, intensity, status, ...rest } = beat;
    const nextLabel = patch.label === undefined ? label : patch.label.trim() || undefined;
    const nextIntensity =
      patch.intensity === undefined ? intensity : (patch.intensity ?? undefined);
    const nextStatus =
      patch.status === undefined ? status : patch.status === "draft" ? undefined : patch.status;
    return {
      ...rest,
      ...(patch.typeId === undefined ? {} : { typeId: patch.typeId }),
      ...(nextLabel === undefined ? {} : { label: nextLabel }),
      ...(nextIntensity === undefined ? {} : { intensity: nextIntensity }),
      ...(nextStatus === undefined ? {} : { status: nextStatus }),
    };
  });
}

export function updateBlockText(story: Story, blockId: BlockId, text: string): Story {
  return mapBeats(story, (beat) =>
    beat.blocks.some((block) => block.id === blockId)
      ? {
          ...beat,
          blocks: beat.blocks.map((block): Block =>
            block.id === blockId ? { ...block, text } : block,
          ),
        }
      : beat,
  );
}

/** Moves a beat to `toIndex` within `toPhaseId`, counted after the beat has been removed. */
export function moveBeat(story: Story, beatId: BeatId, toPhaseId: PhaseId, toIndex: number): Story {
  const found = findBeat(story, beatId);
  if (found === null || !story.phases.some((phase) => phase.id === toPhaseId)) return story;

  const without = mapPhases(story, (phase) =>
    phase.id === found.phase.id
      ? { ...phase, beats: phase.beats.filter((beat) => beat.id !== beatId) }
      : phase,
  );
  return mapPhases(without, (phase) => {
    if (phase.id !== toPhaseId) return phase;
    const index = Math.max(0, Math.min(toIndex, phase.beats.length));
    return {
      ...phase,
      beats: [...phase.beats.slice(0, index), found.beat, ...phase.beats.slice(index)],
    };
  });
}

export const NEW_PHASE_TITLE = "New phase";

/** Starts a new phase at `beatId`: that beat and every beat after it move into it. */
export function splitPhaseAt(story: Story, beatId: BeatId, ids: IdFactory = newId): Story {
  const found = findBeat(story, beatId);
  if (found === null || found.beatIndex === 0) return story;

  const head: Phase = { ...found.phase, beats: found.phase.beats.slice(0, found.beatIndex) };
  const tail: Phase = {
    id: ids.phase(),
    title: NEW_PHASE_TITLE,
    beats: found.phase.beats.slice(found.beatIndex),
  };
  return {
    ...story,
    phases: [
      ...story.phases.slice(0, found.phaseIndex),
      head,
      tail,
      ...story.phases.slice(found.phaseIndex + 1),
    ],
  };
}

/** Joins a phase into the one before it. The first phase cannot be merged. */
export function mergePhaseWithPrevious(story: Story, phaseId: PhaseId): Story {
  const index = story.phases.findIndex((phase) => phase.id === phaseId);
  const previous = story.phases[index - 1];
  const phase = story.phases[index];
  if (previous === undefined || phase === undefined) return story;

  return {
    ...story,
    phases: [
      ...story.phases.slice(0, index - 1),
      { ...previous, beats: [...previous.beats, ...phase.beats] },
      ...story.phases.slice(index + 1),
    ],
  };
}

/** Removes a phase and every card in it; the phases after it move up one place. */
export function deletePhase(story: Story, phaseId: PhaseId): Story {
  const phases = story.phases.filter((phase) => phase.id !== phaseId);
  return phases.length === story.phases.length ? story : { ...story, phases };
}

/** Appends a beat's blocks to the previous beat in the same phase and removes it. */
export function mergeBeatWithPrevious(story: Story, beatId: BeatId): Story {
  const found = findBeat(story, beatId);
  const previous = found?.phase.beats[found.beatIndex - 1];
  if (found === null || previous === undefined) return story;

  return mapPhases(story, (phase) =>
    phase.id !== found.phase.id
      ? phase
      : {
          ...phase,
          beats: phase.beats
            .filter((beat) => beat.id !== beatId)
            .map((beat) =>
              beat.id === previous.id
                ? { ...beat, blocks: [...beat.blocks, ...found.beat.blocks] }
                : beat,
            ),
        },
  );
}

export function deleteBeat(story: Story, beatId: BeatId): Story {
  return mapPhases(story, (phase) => ({
    ...phase,
    beats: phase.beats.filter((beat) => beat.id !== beatId),
  }));
}

export interface NewBeat {
  readonly typeId?: CardTypeId;
  readonly blocks?: readonly NewBlock[];
}

/**
 * Inserts a card into a phase at `index` (default: the end) and returns its id. Without
 * blocks it starts with one empty text block, ready to write in.
 */
export function insertBeat(
  story: Story,
  phaseId: PhaseId,
  index?: number,
  beat: NewBeat = {},
  ids: IdFactory = newId,
): { story: Story; beatId: BeatId | null } {
  if (!story.phases.some((phase) => phase.id === phaseId)) return { story, beatId: null };

  const created: Beat = {
    id: ids.beat(),
    typeId: beat.typeId ?? defaultCardType(story).id,
    blocks: (beat.blocks ?? [{ type: "action" }]).map((block) => toBlock(block, ids)),
  };
  return {
    story: mapPhases(story, (phase) => {
      if (phase.id !== phaseId) return phase;
      const at = Math.max(0, Math.min(index ?? phase.beats.length, phase.beats.length));
      return { ...phase, beats: [...phase.beats.slice(0, at), created, ...phase.beats.slice(at)] };
    }),
    beatId: created.id,
  };
}

export function addPhase(story: Story, ids: IdFactory = newId): Story {
  return {
    ...story,
    phases: [...story.phases, { id: ids.phase(), title: NEW_PHASE_TITLE, beats: [] }],
  };
}

function mapPhases(story: Story, map: (phase: Phase) => Phase): Story {
  return { ...story, phases: story.phases.map(map) };
}

function mapBeats(story: Story, map: (beat: Beat) => Beat): Story {
  return mapPhases(story, (phase) => ({ ...phase, beats: phase.beats.map(map) }));
}

// ---------- blocks and speakers ----------

export type NewBlock =
  | { readonly type: "action"; readonly text?: string }
  | { readonly type: "line"; readonly speaker: EntityId | null; readonly text?: string }
  | { readonly type: "note"; readonly text?: string }
  | { readonly type: "image"; readonly src: string; readonly text?: string };

/** Inserts a block into a beat at `index` (default: the end) and returns its id. */
export function addBlock(
  story: Story,
  beatId: BeatId,
  block: NewBlock,
  index?: number,
  ids: IdFactory = newId,
): { story: Story; blockId: BlockId | null } {
  if (findBeat(story, beatId) === null) return { story, blockId: null };

  const created = toBlock(block, ids);
  const id = created.id;

  return {
    story: mapBeats(story, (beat) => {
      if (beat.id !== beatId) return beat;
      const at = Math.max(0, Math.min(index ?? beat.blocks.length, beat.blocks.length));
      return { ...beat, blocks: [...beat.blocks.slice(0, at), created, ...beat.blocks.slice(at)] };
    }),
    blockId: id,
  };
}

export function removeBlock(story: Story, blockId: BlockId): Story {
  return mapBeats(story, (beat) =>
    beat.blocks.some((block) => block.id === blockId)
      ? { ...beat, blocks: beat.blocks.filter((block) => block.id !== blockId) }
      : beat,
  );
}

/** Turns a block into prose, a spoken line or a note, keeping its text and id. */
export function setBlockType(story: Story, blockId: BlockId, type: TextBlockType): Story {
  return mapBlocks(story, blockId, (block): Block => {
    if (block.type === type || block.type === "image") return block;
    const { id, text } = block;
    if (type === "line") return { type, id, text, speaker: null };
    if (type === "note") return { type, id, text, kind: "idea" };
    return { type, id, text };
  });
}

export function setLineSpeaker(story: Story, blockId: BlockId, speaker: EntityId | null): Story {
  return mapBlocks(story, blockId, (block) =>
    block.type === "line" ? { ...block, speaker } : block,
  );
}

/** Sets a line's delivery note, such as "whispering". Empty text removes it. */
export function setLineDirection(story: Story, blockId: BlockId, direction: string): Story {
  return mapBlocks(story, blockId, (block) => {
    if (block.type !== "line") return block;
    const { direction: _old, ...rest } = block;
    return direction.trim() === "" ? rest : { ...rest, direction };
  });
}

/** Finds a character by name (case-insensitive) or adds one. */
export function ensureCharacter(
  story: Story,
  name: string,
  ids: IdFactory = newId,
): { story: Story; entityId: EntityId } {
  const trimmed = name.trim();
  const key = trimmed.toLocaleLowerCase();
  const existing = story.entities.find(
    (entity) =>
      entity.name.toLocaleLowerCase() === key ||
      entity.aliases.some((alias) => alias.toLocaleLowerCase() === key),
  );
  if (existing !== undefined) return { story, entityId: existing.id };

  const entity: Entity = {
    id: ids.entity(),
    kind: "character",
    name: trimmed,
    aliases: [],
    color: nextSwatch(story.entities.map((other) => other.color)),
  };
  return { story: { ...story, entities: [...story.entities, entity] }, entityId: entity.id };
}

function mapBlocks(story: Story, blockId: BlockId, map: (block: Block) => Block): Story {
  return mapBeats(story, (beat) =>
    beat.blocks.some((block) => block.id === blockId)
      ? { ...beat, blocks: beat.blocks.map((block) => (block.id === blockId ? map(block) : block)) }
      : beat,
  );
}

// ---------- characters ----------

export function updateEntity(
  story: Story,
  entityId: EntityId,
  /** An empty `actor` removes the casting. */
  patch: { readonly name?: string; readonly color?: Swatch; readonly actor?: string },
): Story {
  return {
    ...story,
    entities: story.entities.map((entity) => {
      if (entity.id !== entityId) return entity;
      const { actor, ...rest } = { ...entity, ...patch };
      return actor === undefined || actor.trim() === "" ? rest : { ...rest, actor };
    }),
  };
}

/** Removes a character; their lines keep their text and become unattributed. */
export function removeEntity(story: Story, entityId: EntityId): Story {
  return {
    ...mapBeats(story, (beat) =>
      beat.blocks.some((block) => block.type === "line" && block.speaker === entityId)
        ? {
            ...beat,
            blocks: beat.blocks.map((block) =>
              block.type === "line" && block.speaker === entityId
                ? { ...block, speaker: null }
                : block,
            ),
          }
        : beat,
    ),
    entities: story.entities.filter((entity) => entity.id !== entityId),
  };
}

// ---------- card types ----------

export function addCardType(
  story: Story,
  name: string,
  ids: IdFactory = newId,
): { story: Story; typeId: CardTypeId } {
  const type: CardType = {
    id: ids.cardType(),
    name: name.trim(),
    color: nextSwatch(story.cardTypes.map((other) => other.color)),
  };
  return { story: { ...story, cardTypes: [...story.cardTypes, type] }, typeId: type.id };
}

export function updateCardType(
  story: Story,
  typeId: CardTypeId,
  patch: { readonly name?: string; readonly color?: Swatch },
): Story {
  return {
    ...story,
    cardTypes: story.cardTypes.map((type) => (type.id === typeId ? { ...type, ...patch } : type)),
  };
}

/**
 * Removes a card type. Its cards move to `fallback` (default: the first remaining type).
 * The last type cannot be removed, since every card needs one.
 */
export function removeCardType(story: Story, typeId: CardTypeId, fallback?: CardTypeId): Story {
  const remaining = story.cardTypes.filter((type) => type.id !== typeId);
  const target = remaining.find((type) => type.id === fallback) ?? remaining[0];
  if (target === undefined || remaining.length === story.cardTypes.length) return story;

  return {
    ...mapBeats(story, (beat) => (beat.typeId === typeId ? { ...beat, typeId: target.id } : beat)),
    cardTypes: remaining,
  };
}

/** Moves a card type one step up or down in the list; the first one is the default. */
export function moveCardType(story: Story, typeId: CardTypeId, delta: -1 | 1): Story {
  const index = story.cardTypes.findIndex((type) => type.id === typeId);
  const target = index + delta;
  const type = story.cardTypes[index];
  if (type === undefined || target < 0 || target >= story.cardTypes.length) return story;

  const types = story.cardTypes.filter((other) => other.id !== typeId);
  return { ...story, cardTypes: [...types.slice(0, target), type, ...types.slice(target)] };
}

function toBlock(block: NewBlock, ids: IdFactory): Block {
  const id = ids.block();
  const text = block.text ?? "";
  if (block.type === "line") return { type: "line", id, speaker: block.speaker, text };
  if (block.type === "note") return { type: "note", id, kind: "idea", text };
  if (block.type === "image") return { type: "image", id, src: block.src, text };
  return { type: "action", id, text };
}
