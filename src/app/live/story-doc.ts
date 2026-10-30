import { generateNKeysBetween } from "fractional-indexing";
import type * as Y from "yjs";

import { readSettings } from "@core/model";
import type { Beat, Block, CardType, Entity, Phase, Story } from "@core/model";

/**
 * A story as a shared Yjs document, so several people can edit it at once and every copy
 * ends up the same. Each card type, character, phase, card and block is its own entry, keyed
 * by its id. Where it sits is a separate entry from what it says, so one person moving a card
 * while another edits it keeps both. Two people changing different blocks or cards never touch
 * each other's work; the same block edited at the same moment keeps the later edit.
 */

interface Place {
  /** Order among siblings, a fractional index that sorts as a string. */
  readonly o: string;
  /** Parent id: a block's card, a card's phase. */
  readonly p?: string;
}

interface Collection<V> {
  readonly values: Y.Map<V>;
  readonly places: Y.Map<Place>;
}

type PhaseFields = Omit<Phase, "beats">;
type BeatFields = Omit<Beat, "blocks">;

function collection<V>(doc: Y.Doc, name: string): Collection<V> {
  return { values: doc.getMap<V>(name), places: doc.getMap<Place>(`${name}.places`) };
}

function maps(doc: Y.Doc) {
  return {
    meta: doc.getMap<string>("meta"),
    cardTypes: collection<CardType>(doc, "cardTypes"),
    entities: collection<Entity>(doc, "entities"),
    phases: collection<PhaseFields>(doc, "phases"),
    beats: collection<BeatFields>(doc, "beats"),
    blocks: collection<Block>(doc, "blocks"),
  };
}

interface Item<V> {
  readonly id: string;
  readonly parent?: string;
  readonly value: V;
  /** Whether the value differs from the last synced story's; new items count as changed. */
  readonly changed: boolean;
}

/**
 * Writes the difference between `synced` (the story the document already holds) and `next`.
 * Comparing against `synced` rather than the document means an edit never undoes a change a
 * friend made since: only what this side changed is written.
 */
export function writeStory(doc: Y.Doc, synced: Story | null, next: Story, origin: unknown): void {
  const m = maps(doc);
  doc.transact(() => {
    if (synced?.title !== next.title) m.meta.set("title", next.title);
    if (synced?.id !== next.id) m.meta.set("id", next.id);
    if (synced?.settings !== next.settings) {
      m.meta.set("settings", JSON.stringify(next.settings ?? {}));
    }

    const before = index(synced);
    sync(
      m.cardTypes,
      next.cardTypes.map((v) => item(v.id, undefined, v, before.cardTypes.get(v.id), same)),
    );
    sync(
      m.entities,
      next.entities.map((v) => item(v.id, undefined, v, before.entities.get(v.id), same)),
    );
    sync(
      m.phases,
      next.phases.map((phase) =>
        item(phase.id, undefined, phaseFields(phase), before.phases.get(phase.id), samePhase),
      ),
    );
    sync(
      m.beats,
      next.phases.flatMap((phase) =>
        phase.beats.map((beat) =>
          item(beat.id, phase.id, beatFields(beat), before.beats.get(beat.id), sameBeat),
        ),
      ),
    );
    sync(
      m.blocks,
      next.phases.flatMap((phase) =>
        phase.beats.flatMap((beat) =>
          beat.blocks.map((block) =>
            item(block.id, beat.id, block, before.blocks.get(block.id), same),
          ),
        ),
      ),
    );

    // Deleted here: gone from `next` but there when last synced.
    const nextIds = idsOf(next);
    for (const [name, ids] of Object.entries(before.ids)) {
      const { values, places } = m[name as keyof typeof before.ids];
      for (const id of ids) {
        if (nextIds[name as keyof typeof nextIds].has(id)) continue;
        values.delete(id);
        places.delete(id);
      }
    }
  }, origin);
}

/** Text from other computers: anything unreadable counts as nothing. */
function parseJson(text: string | undefined): unknown {
  try {
    return text === undefined ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

/** The story the document holds now. `previous` lets unchanged parts keep their objects. */
export function readStory(doc: Y.Doc, previous: Story | null): Story | null {
  const m = maps(doc);
  const id = m.meta.get("id");
  if (id === undefined) return null;

  const old = index(previous);
  const blocksByBeat = group(m.blocks);
  const beatsByPhase = group(m.beats);
  const phaseList = group(m.phases).get("") ?? [];

  const buildBeat = ([beatId, fields]: [string, BeatFields]): Beat => {
    const blocks = (blocksByBeat.get(beatId) ?? []).map(([, block]) => block);
    const was = old.beats.get(beatId);
    if (was !== undefined && sameBeat(was, fields as Beat) && sameList(was.blocks, blocks)) {
      return was;
    }
    return { ...fields, blocks } as Beat;
  };

  // A card whose phase someone deleted meanwhile goes to the first phase, so no work is lost.
  const firstPhase = phaseList[0]?.[0];
  const orphans = [...beatsByPhase.entries()]
    .filter(([phaseId]) => !m.phases.values.has(phaseId))
    .flatMap(([, beats]) => beats);

  const phases = phaseList.map(([phaseId, fields]) => {
    const own = beatsByPhase.get(phaseId) ?? [];
    const beats = (phaseId === firstPhase ? [...own, ...orphans] : own).map(buildBeat);
    const was = old.phases.get(phaseId);
    if (was !== undefined && samePhase(was, fields as Phase) && sameList(was.beats, beats)) {
      return was;
    }
    return { ...fields, beats } as Phase;
  });

  const cardTypes = (group(m.cardTypes).get("") ?? []).map(([, value]) => value);
  const entities = (group(m.entities).get("") ?? []).map(([, value]) => value);
  const title = m.meta.get("title") ?? "";
  const settings = readSettings(parseJson(m.meta.get("settings")));
  const sameSettings = JSON.stringify(previous?.settings) === JSON.stringify(settings);
  if (
    previous !== null &&
    previous.id === id &&
    previous.title === title &&
    sameSettings &&
    sameList(previous.phases, phases) &&
    sameList(previous.cardTypes, cardTypes) &&
    sameList(previous.entities, entities)
  ) {
    return previous;
  }
  return {
    id: id as Story["id"],
    title,
    cardTypes,
    entities,
    phases,
    ...(settings === undefined ? {} : { settings: sameSettings ? previous?.settings : settings }),
  };
}

/** Writes changed values, and places for new or moved items between their neighbours. */
function sync<V>({ values, places }: Collection<V>, items: readonly Item<V>[]): void {
  const byParent = new Map<string, Item<V>[]>();
  for (const it of items) {
    const key = it.parent ?? "";
    byParent.set(key, [...(byParent.get(key) ?? []), it]);
  }
  for (const [parent, siblings] of byParent) {
    const keys = orderKeys(
      siblings.map((it) => {
        const place = places.get(it.id);
        return place !== undefined && (place.p ?? "") === parent ? place.o : null;
      }),
    );
    siblings.forEach((it, i) => {
      // Unchanged here: leave the value alone, it may hold a friend's newer edit.
      if (it.changed || !values.has(it.id)) values.set(it.id, it.value);
      const place = places.get(it.id);
      const o = keys[i] ?? "";
      if (place?.o === o && (place.p ?? "") === parent) return;
      places.set(it.id, it.parent === undefined ? { o } : { o, p: it.parent });
    });
  }
}

/**
 * Order keys for a list, keeping as many existing keys as possible (those already in order)
 * so a move rewrites only the moved items, and a friend's concurrent move elsewhere survives.
 */
export function orderKeys(current: readonly (string | null)[]): string[] {
  const keep = longestIncreasing(current);
  const result: (string | null)[] = current.map((key, i) => (keep.has(i) ? key : null));
  let i = 0;
  while (i < result.length) {
    if (result[i] !== null) {
      i += 1;
      continue;
    }
    let end = i;
    while (end < result.length && result[end] === null) end += 1;
    const fresh = generateNKeysBetween(result[i - 1] ?? null, result[end] ?? null, end - i);
    fresh.forEach((key, offset) => (result[i + offset] = key));
    i = end;
  }
  return result as string[];
}

/** Indexes of a longest strictly increasing run of keys (nulls skipped). */
function longestIncreasing(keys: readonly (string | null)[]): Set<number> {
  const tails: number[] = [];
  const previous: number[] = keys.map(() => -1);
  keys.forEach((key, i) => {
    if (key === null) return;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((keys[tails[mid] ?? 0] ?? "") < key) lo = mid + 1;
      else hi = mid;
    }
    previous[i] = lo > 0 ? (tails[lo - 1] ?? -1) : -1;
    tails[lo] = i;
  });
  const kept = new Set<number>();
  for (let i = tails.at(-1) ?? -1; i !== -1; i = previous[i] ?? -1) kept.add(i);
  return kept;
}

/**
 * Values by parent, each list in order. An item needs both a value and a place: one deleted
 * while someone else moved or edited it stays deleted.
 */
function group<V>({ values, places }: Collection<V>): Map<string, [string, V][]> {
  const groups = new Map<string, [string, Place, V][]>();
  for (const [id, place] of places.entries()) {
    const value = values.get(id);
    if (value === undefined) continue;
    const key = place.p ?? "";
    groups.set(key, [...(groups.get(key) ?? []), [id, place, value]]);
  }
  const result = new Map<string, [string, V][]>();
  for (const [key, list] of groups) {
    // Equal keys (two people inserting at one spot) fall back to the id: same on every copy.
    list.sort(([a, x], [b, y]) => (x.o < y.o ? -1 : x.o > y.o ? 1 : a < b ? -1 : 1));
    result.set(
      key,
      list.map(([id, , value]) => [id, value]),
    );
  }
  return result;
}

function item<V, T>(
  id: string,
  parent: string | undefined,
  value: V,
  was: T | undefined,
  equal: (a: T, b: T) => boolean,
): Item<V> {
  const changed = was === undefined || !equal(was, value as unknown as T);
  return parent === undefined ? { id, value, changed } : { id, parent, value, changed };
}

function index(story: Story | null) {
  const cardTypes = new Map<string, CardType>();
  const entities = new Map<string, Entity>();
  const phases = new Map<string, Phase>();
  const beats = new Map<string, Beat>();
  const blocks = new Map<string, Block>();
  for (const v of story?.cardTypes ?? []) cardTypes.set(v.id, v);
  for (const v of story?.entities ?? []) entities.set(v.id, v);
  for (const phase of story?.phases ?? []) {
    phases.set(phase.id, phase);
    for (const beat of phase.beats) {
      beats.set(beat.id, beat);
      for (const block of beat.blocks) blocks.set(block.id, block);
    }
  }
  return {
    cardTypes,
    entities,
    phases,
    beats,
    blocks,
    ids: {
      cardTypes: new Set(cardTypes.keys()),
      entities: new Set(entities.keys()),
      phases: new Set(phases.keys()),
      beats: new Set(beats.keys()),
      blocks: new Set(blocks.keys()),
    },
  };
}

function idsOf(story: Story) {
  return index(story).ids;
}

const phaseFields = ({ beats: _beats, ...fields }: Phase): PhaseFields => fields;
const beatFields = ({ blocks: _blocks, ...fields }: Beat): BeatFields => fields;

/** Edits replace objects, so an unchanged part is the very same object. */
function same<T>(a: T, b: T): boolean {
  return a === b;
}

/** Same own fields, ignoring the children, which are entries of their own. */
function shallowSame(a: object, b: object, skip: string): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.delete(skip);
  for (const key of keys) {
    if ((a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key]) return false;
  }
  return true;
}

const samePhase = (a: Phase, b: Phase) => shallowSame(a, b, "beats");
const sameBeat = (a: Beat, b: Beat) => shallowSame(a, b, "blocks");

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}
