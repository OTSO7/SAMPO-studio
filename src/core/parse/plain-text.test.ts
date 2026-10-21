import { describe, expect, it } from "vitest";

import { createIdFactory, type Block, type Entity, type IdSource, type LineBlock } from "../model";
import lighthouse from "./__fixtures__/lighthouse.txt?raw";
import { parsePlainText } from "./plain-text";

function deterministicIds() {
  let time = 0;
  const source: IdSource = { now: () => time++, fillRandom: (bytes) => bytes.fill(0) };
  return createIdFactory(source);
}

const lines = (blocks: readonly Block[]): LineBlock[] =>
  blocks.filter((block): block is LineBlock => block.type === "line");

describe("parsePlainText", () => {
  const story = parsePlainText(lighthouse, { title: "Majakka", ids: deterministicIds() });
  const [first, second] = story.phases;

  it("splits the text into phases", () => {
    expect(story.title).toBe("Majakka");
    expect(story.phases.map((phase) => phase.title)).toEqual(["Saapuminen ja hiljaisuus", "Torni"]);
  });

  it("reads each phase's location without the trailing period", () => {
    expect(first?.location).toBe("Majakkasaari ja vartijan mökki");
    expect(second?.location).toBe("Majakan kierreportaat");
  });

  it("turns every paragraph into a beat and skips section markers", () => {
    expect(first?.beats).toHaveLength(3);
    expect(second?.beats).toHaveLength(4);
  });

  it("uses a leading label as the beat heading and kind", () => {
    expect(second?.beats.map((beat) => [beat.label, beat.kind])).toEqual([
      ["Minipeli", "mechanic"],
      ["The Shift", "shift"],
      [undefined, "narrative"],
      ["Oivallus", "insight"],
    ]);
  });

  it("does not repeat the label in the beat text", () => {
    const minigame = second?.beats[0]?.blocks[0];
    expect(minigame).toEqual(
      expect.objectContaining({ type: "action", text: expect.stringMatching(/^Pelaaja korjaa/u) }),
    );
  });

  it("extracts attributed speech as lines with speaker and direction", () => {
    const investigation = first?.beats[2];
    expect(investigation?.blocks.map((block) => block.type)).toEqual(["action", "line"]);

    const [line] = lines(investigation?.blocks ?? []);
    expect(line?.text).toBe("Valo ei sammunut itsestään. Joku on portaissa.");
    expect(line?.direction).toBe("kirjoittaa vapisevalla käsialalla");
    expect(story.entities.find((entity) => entity.id === line?.speaker)?.name).toBe("Vartija");
  });

  it("keeps quotations without attribution as prose", () => {
    const beat = second?.beats[2];
    expect(beat?.blocks[0]).toEqual(
      expect.objectContaining({ type: "action", text: 'Ovessa lukee "Vartija K. Saari".' }),
    );
  });

  it("creates each speaker once and reuses them", () => {
    const mirjaLines = story.phases
      .flatMap((phase) => phase.beats)
      .flatMap((beat) => lines(beat.blocks))
      .filter((line) => line.text !== "Valo ei sammunut itsestään. Joku on portaissa.");

    expect(mirjaLines).toHaveLength(2);
    expect(new Set(mirjaLines.map((line) => line.speaker)).size).toBe(1);
    expect(story.entities.map((entity) => entity.name)).toEqual(["Vartija", "Mirja"]);
  });

  it("gives every node a unique id", () => {
    const all = [
      story.id,
      ...story.entities.map((entity) => entity.id),
      ...story.phases.flatMap((phase) => [
        phase.id,
        ...phase.beats.flatMap((beat) => [beat.id, ...beat.blocks.map((block) => block.id)]),
      ]),
    ];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("parsePlainText edge cases", () => {
  it("resolves speakers to existing entities by name or alias", () => {
    const ids = deterministicIds();
    const mirja: Entity = { id: ids.entity(), kind: "character", name: "Mirja", aliases: ["M."] };

    const story = parsePlainText('M. huutaa: "Odota!"', { entities: [mirja], ids });
    const [line] = lines(story.phases[0]?.beats[0]?.blocks ?? []);

    expect(line?.speaker).toBe(mirja.id);
    expect(story.entities).toEqual([mirja]);
  });

  it("collects text before the first heading into an untitled phase", () => {
    const story = parsePlainText("Alkusanat.\n\nVAIHE 1: Alku\n\nTeksti.");
    expect(story.phases.map((phase) => phase.title)).toEqual(["Nimetön vaihe", "Alku"]);
  });

  it("handles Windows line endings and joins wrapped lines", () => {
    const story = parsePlainText("VAIHE 1: Alku\r\n\r\nEnsimmäinen rivi\r\njatkuu tässä.\r\n");
    expect(story.phases[0]?.beats[0]?.blocks).toEqual([
      expect.objectContaining({ text: "Ensimmäinen rivi jatkuu tässä." }),
    ]);
  });

  it("does not mistake attributed speech for a label", () => {
    const story = parsePlainText('Elias sanoo: "Älä mene."');
    const beat = story.phases[0]?.beats[0];
    expect(beat?.label).toBeUndefined();
    expect(lines(beat?.blocks ?? [])[0]?.text).toBe("Älä mene.");
  });

  it("returns an empty story for empty input", () => {
    const story = parsePlainText("   \n\n ");
    expect(story.phases).toEqual([]);
    expect(story.title).toBe("Nimetön tarina");
  });
});
