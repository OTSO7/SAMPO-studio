import type { Beat, Block, CardType, Entity, Phase, Story } from "../model";
import { CURRENT_VERSION, FORMAT_ID } from "./format";

export interface SerializeOptions {
  /** ISO timestamp recorded in the file. Left out when omitted so output is reproducible. */
  readonly savedAt?: string;
}

/**
 * Serializes a story into the `.sampo` file format.
 *
 * Every object is rebuilt with an explicit key order so the same story always produces the
 * same bytes. That keeps saves stable and makes accidental changes easy to spot.
 */
export function serializeStory(story: Story, options: SerializeOptions = {}): string {
  const file = {
    format: FORMAT_ID,
    version: CURRENT_VERSION,
    ...(options.savedAt === undefined ? {} : { savedAt: options.savedAt }),
    story: {
      id: story.id,
      title: story.title,
      cardTypes: story.cardTypes.map(cardTypeToJson),
      entities: story.entities.map(entityToJson),
      phases: story.phases.map(phaseToJson),
    },
  };

  return `${JSON.stringify(file, null, 2)}\n`;
}

function cardTypeToJson(type: CardType) {
  return { id: type.id, name: type.name, color: type.color };
}

function entityToJson(entity: Entity) {
  return {
    id: entity.id,
    kind: entity.kind,
    name: entity.name,
    aliases: entity.aliases,
    ...optional("color", entity.color),
    ...optional("description", entity.description),
    ...optional("actor", entity.actor),
  };
}

function phaseToJson(phase: Phase) {
  return {
    id: phase.id,
    title: phase.title,
    ...optional("location", phase.location),
    beats: phase.beats.map(beatToJson),
  };
}

function beatToJson(beat: Beat) {
  return {
    id: beat.id,
    typeId: beat.typeId,
    ...optional("label", beat.label),
    ...optional("intensity", beat.intensity),
    ...optional("status", beat.status),
    ...optional("threads", beat.threads),
    blocks: beat.blocks.map(blockToJson),
  };
}

function blockToJson(block: Block) {
  switch (block.type) {
    case "action":
      return { type: block.type, id: block.id, text: block.text };
    case "line":
      return {
        type: block.type,
        id: block.id,
        speaker: block.speaker,
        ...optional("direction", block.direction),
        text: block.text,
        ...optional("take", block.take),
      };
    case "note":
      return { type: block.type, id: block.id, kind: block.kind, text: block.text };
    case "image":
      return { type: block.type, id: block.id, text: block.text, src: block.src };
    case "audio":
      // Music writes exactly what earlier versions wrote; only effects carry a role.
      return {
        type: block.type,
        id: block.id,
        text: block.text,
        src: block.src,
        ...optional("role", block.role),
      };
  }
}

function optional<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<K, V>>);
}
