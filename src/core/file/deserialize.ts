import {
  ENTITY_KINDS,
  mediaIdOf,
  NOTE_KINDS,
  SWATCHES,
  type Beat,
  type Block,
  type CardType,
  type Entity,
  type Intensity,
  type Phase,
  type Story,
} from "../model";
import { CURRENT_VERSION, FORMAT_ID } from "./format";
import { migrate } from "./migrations";
import { Reader } from "./reader";

export type LoadResult =
  | { readonly ok: true; readonly story: Story }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Parses and validates the contents of a `.sampo` file.
 *
 * Never throws: a broken file is a normal situation for a desktop app (a sync conflict, a
 * half-written copy, a hand edit gone wrong) and deserves a readable explanation.
 */
export function deserializeStory(text: string): LoadResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return failure([`The file is not valid JSON: ${(error as Error).message}`]);
  }

  const r = new Reader();
  const file = r.object(data, "file");
  if (file === undefined) return failure(r.errors);

  if (file["format"] !== FORMAT_ID) {
    return failure(["This is not a SAMPO story file."]);
  }

  const version = r.integer(file["version"], 1, Number.MAX_SAFE_INTEGER, "version");
  if (version === undefined) return failure(r.errors);
  if (version > CURRENT_VERSION) {
    return failure([
      `The file was saved by a newer version of SAMPO (format ${version}). Update the app to open it.`,
    ]);
  }

  let payload: unknown;
  try {
    payload = migrate(file["story"], version);
  } catch (error) {
    return failure([(error as Error).message]);
  }

  const story = readStory(r, payload);
  if (story === undefined || r.errors.length > 0) return failure(r.errors);

  const integrityErrors = checkIntegrity(story);
  return integrityErrors.length > 0 ? failure(integrityErrors) : { ok: true, story };
}

function failure(errors: readonly string[]): LoadResult {
  return { ok: false, errors };
}

function readStory(r: Reader, value: unknown): Story | undefined {
  const o = r.object(value, "story");
  if (o === undefined) return undefined;

  const id = r.id("story", o["id"], "story.id");
  const title = r.string(o["title"], "story.title");
  const cardTypes = r.each(o["cardTypes"], "story.cardTypes", (item, path) =>
    readCardType(r, item, path),
  );
  const entities = r.each(o["entities"], "story.entities", (item, path) =>
    readEntity(r, item, path),
  );
  const phases = r.each(o["phases"], "story.phases", (item, path) => readPhase(r, item, path));

  if (cardTypes.length === 0 && r.errors.length === 0) {
    r.fail("story.cardTypes", "a story needs at least one card type");
  }
  if (id === undefined || title === undefined) return undefined;
  return { id, title, cardTypes, entities, phases };
}

function readCardType(r: Reader, value: unknown, path: string): CardType | undefined {
  const o = r.object(value, path);
  if (o === undefined) return undefined;

  const id = r.id("cardType", o["id"], `${path}.id`);
  const name = r.string(o["name"], `${path}.name`);
  const color = r.oneOf(o["color"], SWATCHES, `${path}.color`);

  if (id === undefined || name === undefined || color === undefined) return undefined;
  return { id, name, color };
}

function readEntity(r: Reader, value: unknown, path: string): Entity | undefined {
  const o = r.object(value, path);
  if (o === undefined) return undefined;

  const id = r.id("entity", o["id"], `${path}.id`);
  const kind = r.oneOf(o["kind"], ENTITY_KINDS, `${path}.kind`);
  const name = r.string(o["name"], `${path}.name`);
  const aliases = r.each(o["aliases"], `${path}.aliases`, (item, p) => r.string(item, p));
  const description = r.optionalString(o["description"], `${path}.description`);
  const actor = r.optionalString(o["actor"], `${path}.actor`);
  const color =
    o["color"] === undefined ? undefined : r.oneOf(o["color"], SWATCHES, `${path}.color`);

  if (id === undefined || kind === undefined || name === undefined) return undefined;
  return {
    id,
    kind,
    name,
    aliases,
    ...(color === undefined ? {} : { color }),
    ...(description === undefined ? {} : { description }),
    ...(actor === undefined ? {} : { actor }),
  };
}

function readPhase(r: Reader, value: unknown, path: string): Phase | undefined {
  const o = r.object(value, path);
  if (o === undefined) return undefined;

  const id = r.id("phase", o["id"], `${path}.id`);
  const title = r.string(o["title"], `${path}.title`);
  const location = r.optionalString(o["location"], `${path}.location`);
  const beats = r.each(o["beats"], `${path}.beats`, (item, p) => readBeat(r, item, p));

  if (id === undefined || title === undefined) return undefined;
  return { id, title, ...(location === undefined ? {} : { location }), beats };
}

function readBeat(r: Reader, value: unknown, path: string): Beat | undefined {
  const o = r.object(value, path);
  if (o === undefined) return undefined;

  const id = r.id("beat", o["id"], `${path}.id`);
  const typeId = r.id("cardType", o["typeId"], `${path}.typeId`);
  const label = r.optionalString(o["label"], `${path}.label`);
  const intensity =
    o["intensity"] === undefined
      ? undefined
      : (r.integer(o["intensity"], 0, 5, `${path}.intensity`) as Intensity | undefined);
  const status =
    o["status"] === undefined
      ? undefined
      : r.oneOf(o["status"], ["review", "final"] as const, `${path}.status`);
  const threads =
    o["threads"] === undefined
      ? undefined
      : r.each(o["threads"], `${path}.threads`, (item, p) => r.id("entity", item, p));
  const blocks = r.each(o["blocks"], `${path}.blocks`, (item, p) => readBlock(r, item, p));

  if (id === undefined || typeId === undefined) return undefined;
  return {
    id,
    typeId,
    ...(label === undefined ? {} : { label }),
    ...(intensity === undefined ? {} : { intensity }),
    ...(status === undefined ? {} : { status }),
    ...(threads === undefined || threads.length === 0 ? {} : { threads }),
    blocks,
  };
}

function readBlock(r: Reader, value: unknown, path: string): Block | undefined {
  const o = r.object(value, path);
  if (o === undefined) return undefined;

  const id = r.id("block", o["id"], `${path}.id`);
  const text = r.string(o["text"], `${path}.text`);
  const type = r.oneOf(
    o["type"],
    ["action", "line", "note", "image", "audio"] as const,
    `${path}.type`,
  );
  if (id === undefined || text === undefined || type === undefined) return undefined;

  switch (type) {
    case "action":
      return { type, id, text };

    case "line": {
      const speaker =
        o["speaker"] === null ? null : r.id("entity", o["speaker"], `${path}.speaker`);
      const direction = r.optionalString(o["direction"], `${path}.direction`);
      const take = o["take"] === undefined ? undefined : readMedia(r, o["take"], `${path}.take`);
      if (speaker === undefined) return undefined;
      return {
        type,
        id,
        speaker,
        text,
        ...(direction === undefined ? {} : { direction }),
        ...(take === undefined ? {} : { take }),
      };
    }

    case "note": {
      const kind = r.oneOf(o["kind"], NOTE_KINDS, `${path}.kind`);
      return kind === undefined ? undefined : { type, id, kind, text };
    }

    case "image":
    case "audio": {
      // Older stories hold pictures inline; they are packed on the next save.
      const inline = type === "image" && String(o["src"]).startsWith("data:image/");
      const src = inline ? (o["src"] as string) : readMedia(r, o["src"], `${path}.src`);
      return src === undefined ? undefined : { type, id, src, text };
    }
  }
}

/**
 * Only files packed into the story: a path or web address would break as soon as the story
 * moves to another computer.
 */
function readMedia(r: Reader, value: unknown, path: string): string | undefined {
  const src = r.string(value, path);
  if (src === undefined) return undefined;
  return mediaIdOf(src) === null ? r.fail(path, "expected a file packed in the story") : src;
}

/** Cross-references the schema reader cannot see on its own. */
function checkIntegrity(story: Story): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const claim = (id: string, path: string) => {
    if (seen.has(id)) errors.push(`${path}: duplicate id ${id}`);
    seen.add(id);
  };

  const entityIds = new Set(story.entities.map((entity) => entity.id));
  const threadIds = new Set(
    story.entities.filter((entity) => entity.kind === "thread").map((entity) => entity.id),
  );
  const typeIds = new Set(story.cardTypes.map((type) => type.id));
  story.cardTypes.forEach((type, i) => claim(type.id, `story.cardTypes[${i}].id`));
  story.entities.forEach((entity, i) => claim(entity.id, `story.entities[${i}].id`));

  story.phases.forEach((phase, p) => {
    claim(phase.id, `story.phases[${p}].id`);
    phase.beats.forEach((beat, b) => {
      const beatPath = `story.phases[${p}].beats[${b}]`;
      claim(beat.id, `${beatPath}.id`);
      if (!typeIds.has(beat.typeId)) {
        errors.push(`${beatPath}.typeId: unknown card type ${beat.typeId}`);
      }
      beat.threads?.forEach((threadId, t) => {
        if (!threadIds.has(threadId)) {
          errors.push(`${beatPath}.threads[${t}]: unknown thread ${threadId}`);
        }
      });
      beat.blocks.forEach((block, k) => {
        const blockPath = `${beatPath}.blocks[${k}]`;
        claim(block.id, `${blockPath}.id`);
        if (block.type === "line" && block.speaker !== null && !entityIds.has(block.speaker)) {
          errors.push(`${blockPath}.speaker: unknown entity ${block.speaker}`);
        }
      });
    });
  });

  return errors;
}
