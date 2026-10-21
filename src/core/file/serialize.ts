import type { Beat, Block, Entity, Phase, Story } from "../model";
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
      entities: story.entities.map(entityToJson),
      phases: story.phases.map(phaseToJson),
    },
  };

  return `${JSON.stringify(file, null, 2)}\n`;
}

function entityToJson(entity: Entity) {
  return {
    id: entity.id,
    kind: entity.kind,
    name: entity.name,
    aliases: entity.aliases,
    ...optional("description", entity.description),
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
    kind: beat.kind,
    ...optional("label", beat.label),
    ...optional("intensity", beat.intensity),
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
      };
    case "note":
      return { type: block.type, id: block.id, kind: block.kind, text: block.text };
  }
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]?: V });
}
