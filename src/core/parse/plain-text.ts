import {
  newId,
  type Beat,
  type Block,
  type Entity,
  type EntityId,
  type IdFactory,
  type Phase,
  type Story,
} from "../model";
import { beatKindForLabel } from "./beat-kind";
import { splitDialogue } from "./dialogue";

export interface ParseOptions {
  readonly title?: string;
  /** Entities that already exist, so speakers resolve to them instead of duplicates. */
  readonly entities?: readonly Entity[];
  readonly ids?: IdFactory;
}

const PHASE_HEADING = /^vaihe\s+\d+\s*[:.\-–—]\s*(.+)$/iu;
const LOCATION = /^tapahtumapaikka\s*:\s*(.+)$/iu;
const SECTION_MARKER = /^pelitapahtumat\s*:?$/iu;
const BEAT_LABEL = /^([^:.!?"“”„«»]{1,60}):\s+(.+)$/su;
const MAX_LABEL_WORDS = 6;
const QUOTE_START = /^["“”„«»]/u;

const DEFAULT_TITLE = "Nimetön tarina";
const DEFAULT_PHASE_TITLE = "Nimetön vaihe";

interface DraftPhase {
  title: string;
  location?: string;
  paragraphs: string[];
}

/**
 * Parses the loosely structured text authors write in a word processor into a `Story`.
 *
 * The parser is deliberately forgiving: anything it does not recognise becomes a narrative
 * beat, so no text is ever lost. Structure can always be fixed up in the editor afterwards.
 */
export function parsePlainText(source: string, options: ParseOptions = {}): Story {
  const ids = options.ids ?? newId;
  const speakers = new SpeakerRegistry(ids, options.entities ?? []);

  const phases = collectPhases(source).map((draft): Phase => ({
    id: ids.phase(),
    title: draft.title,
    ...(draft.location === undefined ? {} : { location: draft.location }),
    beats: draft.paragraphs.map((paragraph) => toBeat(paragraph, ids, speakers)),
  }));

  return {
    id: ids.story(),
    title: options.title?.trim() || DEFAULT_TITLE,
    phases,
    entities: speakers.all(),
  };
}

function collectPhases(source: string): DraftPhase[] {
  const phases: DraftPhase[] = [];
  let current: DraftPhase | undefined;
  let paragraph: string[] = [];

  const currentPhase = (): DraftPhase => {
    if (current === undefined) {
      current = { title: DEFAULT_PHASE_TITLE, paragraphs: [] };
      phases.push(current);
    }
    return current;
  };

  const flush = () => {
    if (paragraph.length > 0) {
      currentPhase().paragraphs.push(paragraph.join(" "));
      paragraph = [];
    }
  };

  for (const rawLine of source.replace(/\r\n?/gu, "\n").split("\n")) {
    const line = rawLine.trim();

    const heading = PHASE_HEADING.exec(line);
    if (heading !== null) {
      flush();
      current = { title: tidyTitle(heading[1] ?? ""), paragraphs: [] };
      phases.push(current);
      continue;
    }

    const location = LOCATION.exec(line);
    if (location !== null) {
      flush();
      currentPhase().location = (location[1] ?? "").trim().replace(/\.$/u, "");
      continue;
    }

    if (line === "" || SECTION_MARKER.test(line)) {
      flush();
      continue;
    }

    paragraph.push(line);
  }

  flush();
  return phases;
}

function toBeat(paragraph: string, ids: IdFactory, speakers: SpeakerRegistry): Beat {
  const { label, body } = splitLabel(paragraph);

  const blocks = splitDialogue(body).map((segment): Block => {
    if (segment.kind === "action") {
      return { type: "action", id: ids.block(), text: segment.text };
    }
    return {
      type: "line",
      id: ids.block(),
      speaker: segment.speakerName === null ? null : speakers.resolve(segment.speakerName),
      text: segment.text,
      ...(segment.direction === undefined ? {} : { direction: segment.direction }),
    };
  });

  return {
    id: ids.beat(),
    kind: beatKindForLabel(label),
    ...(label === undefined ? {} : { label }),
    blocks,
  };
}

function splitLabel(paragraph: string): { label?: string; body: string } {
  const match = BEAT_LABEL.exec(paragraph);
  const label = match?.[1]?.trim();
  const body = match?.[2]?.trim();

  // `Elias sanoo: "..."` is attributed speech, not a heading.
  if (label === undefined || body === undefined || QUOTE_START.test(body)) {
    return { body: paragraph };
  }
  if (label.split(/\s+/u).length > MAX_LABEL_WORDS) {
    return { body: paragraph };
  }
  return { label, body };
}

/** "MAADOITTUMINEN JA JÄLJET" reads as shouting in the UI; keep mixed-case titles as is. */
function tidyTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed !== trimmed.toLocaleUpperCase("fi")) return trimmed;

  const lower = trimmed.toLocaleLowerCase("fi");
  return lower.charAt(0).toLocaleUpperCase("fi") + lower.slice(1);
}

class SpeakerRegistry {
  private readonly byName = new Map<string, EntityId>();
  private readonly entities: Entity[];

  constructor(
    private readonly ids: IdFactory,
    existing: readonly Entity[],
  ) {
    this.entities = [...existing];
    for (const entity of existing) {
      for (const name of [entity.name, ...entity.aliases]) {
        this.byName.set(normalizeName(name), entity.id);
      }
    }
  }

  resolve(name: string): EntityId {
    const key = normalizeName(name);
    const known = this.byName.get(key);
    if (known !== undefined) return known;

    const entity: Entity = { id: this.ids.entity(), kind: "character", name, aliases: [] };
    this.entities.push(entity);
    this.byName.set(key, entity.id);
    return entity.id;
  }

  all(): readonly Entity[] {
    return this.entities;
  }
}

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase("fi");
}
