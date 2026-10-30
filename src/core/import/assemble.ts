import {
  createStory,
  defaultCardType,
  findCardType,
  newId,
  nextSwatch,
  type Beat,
  type Block,
  type Entity,
  type EntityId,
  type IdFactory,
  type Phase,
  type Story,
} from "../model";
import { stripQuotes } from "./segment";

export const ROW_ROLES = [
  "title",
  "phase",
  "location",
  "beat",
  "text",
  "line",
  "note",
  "skip",
] as const;
export type RowRole = (typeof ROW_ROLES)[number];

/** A row of pasted text and what it becomes in the story. */
export interface ImportRow {
  readonly role: RowRole;
  readonly text: string;
  /** For `line` rows: who speaks. Empty or missing means not decided yet. */
  readonly speaker?: string;
  /** For `beat` rows: the author's heading, such as "Tutoriaali". */
  readonly label?: string;
}

export const UNTITLED_PHASE = "Untitled phase";

interface DraftBeat {
  label?: string;
  blocks: Block[];
}

interface DraftPhase {
  title: string;
  location?: string;
  beats: DraftBeat[];
}

/**
 * Builds a story from marked rows. Every rule is local and predictable:
 *
 * - `title` names the story, `phase` starts a phase, `location` sets the current phase's place.
 * - `beat` starts a beat; `text`, `line` and `note` rows are added to the current beat,
 *   starting one if needed. Phases and beats are created on demand, so no text is lost.
 * - `skip` rows are left out.
 */
export function assembleStory(rows: readonly ImportRow[], ids: IdFactory = newId): Story {
  const story = createStory(undefined, ids);
  const phases: DraftPhase[] = [];
  const cast = new Cast(ids);
  let title = story.title;

  const currentPhase = (): DraftPhase => {
    const last = phases.at(-1);
    if (last !== undefined) return last;
    const phase: DraftPhase = { title: UNTITLED_PHASE, beats: [] };
    phases.push(phase);
    return phase;
  };

  const currentBeat = () => {
    const phase = currentPhase();
    const last = phase.beats.at(-1);
    if (last !== undefined) return last;
    const beat: DraftBeat = { blocks: [] };
    phase.beats.push(beat);
    return beat;
  };

  for (const row of rows) {
    const text = row.text.trim();

    switch (row.role) {
      case "skip":
        break;
      case "title":
        title = text;
        break;
      case "phase":
        phases.push({ title: text, beats: [] });
        break;
      case "location":
        currentPhase().location = text;
        break;
      case "beat": {
        const label = row.label?.trim();
        currentPhase().beats.push({
          ...(label ? { label } : {}),
          // A heading alone: what follows it becomes the card's text.
          blocks: text === "" ? [] : [{ type: "action", id: ids.block(), text }],
        });
        break;
      }
      case "text":
        currentBeat().blocks.push({ type: "action", id: ids.block(), text });
        break;
      case "note":
        currentBeat().blocks.push({ type: "note", id: ids.block(), kind: "idea", text });
        break;
      case "line": {
        const speaker = row.speaker?.trim() ?? "";
        currentBeat().blocks.push({
          type: "line",
          id: ids.block(),
          speaker: speaker === "" ? null : cast.resolve(speaker),
          text: stripQuotes(text),
        });
        break;
      }
    }
  }

  return {
    ...story,
    title,
    phases: phases.map((draft): Phase => ({
      id: ids.phase(),
      title: draft.title,
      ...(draft.location === undefined ? {} : { location: draft.location }),
      beats: draft.beats.map((beat): Beat => ({
        id: ids.beat(),
        // A heading that names one of the story's card types ("Cutscene: ...") picks it.
        typeId: (findCardType(story, beat.label ?? "") ?? defaultCardType(story)).id,
        ...(beat.label === undefined ? {} : { label: beat.label }),
        blocks: beat.blocks,
      })),
    })),
    entities: cast.all(),
  };
}

/** Speakers become characters; the same name always maps to the same character. */
class Cast {
  private readonly byName = new Map<string, EntityId>();
  private readonly entities: Entity[] = [];

  constructor(private readonly ids: IdFactory) {}

  resolve(name: string): EntityId {
    const key = name.toLocaleLowerCase();
    const known = this.byName.get(key);
    if (known !== undefined) return known;

    const entity: Entity = {
      id: this.ids.entity(),
      kind: "character",
      name,
      aliases: [],
      color: nextSwatch(this.entities.map((other) => other.color)),
    };
    this.entities.push(entity);
    this.byName.set(key, entity.id);
    return entity.id;
  }

  all(): readonly Entity[] {
    return this.entities;
  }
}
