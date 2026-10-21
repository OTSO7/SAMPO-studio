import { describe, expect, it } from "vitest";

import { suggestRows } from "./suggest";

const DOCS_PASTE = [
  "ROUTA: Ydinmekaniikat & Demo Slice",
  "",
  "\u200BVAIHE 1: MAADOITTUMINEN JA MUISTIKIRJA",
  "",
  "\u200BTapahtumapaikka: Metsä ja autiotupa.",
  "",
  "\u200BPelitapahtumat: Aatos saapuu tupaan.",
  "\u200BAatos löytää nauhurin.",
  "",
  "\u200BTutkinta-mekaniikka: Pelaaja avaa muistikirjan.",
  "",
  "\u200BVAIHE 2: Tupa",
  "\u200BPelitapahtumat:",
  "Tulos: Hirviö jäätyy.",
].join("\r\n");

describe("suggestRows", () => {
  it("drafts title, phases, locations and one card per paragraph", () => {
    expect(suggestRows(DOCS_PASTE)).toEqual([
      { role: "title", text: "ROUTA: Ydinmekaniikat & Demo Slice" },
      { role: "phase", text: "Maadoittuminen ja muistikirja" },
      { role: "location", text: "Metsä ja autiotupa" },
      { role: "beat", text: "Aatos saapuu tupaan." },
      { role: "beat", text: "Aatos löytää nauhurin." },
      { role: "beat", label: "Tutkinta-mekaniikka", text: "Pelaaja avaa muistikirjan." },
      { role: "phase", text: "Tupa" },
      { role: "beat", label: "Tulos", text: "Hirviö jäätyy." },
    ]);
  });

  it("puts everything into cards when there are no headings", () => {
    expect(suggestRows("Ensimmäinen kappale.\n\nToinen kappale.")).toEqual([
      { role: "beat", text: "Ensimmäinen kappale." },
      { role: "beat", text: "Toinen kappale." },
    ]);
  });

  it("does not mistake speech or long sentences for labels", () => {
    expect(
      suggestRows('Elias sanoo: "Hei."\n\nTämä on aika pitkä alku lauseelle: ja jatkuu.'),
    ).toEqual([
      { role: "beat", text: 'Elias sanoo: "Hei."' },
      { role: "beat", text: "Tämä on aika pitkä alku lauseelle: ja jatkuu." },
    ]);
  });

  it("accepts English headings", () => {
    expect(suggestRows("PHASE 1: Arrival\nLocation: Bog.\nFog rolls in.")).toEqual([
      { role: "phase", text: "Arrival" },
      { role: "location", text: "Bog" },
      { role: "beat", text: "Fog rolls in." },
    ]);
  });
});

describe("suggestRows with other kinds of documents", () => {
  it("reads Markdown headings", () => {
    expect(suggestRows("# The Hollow\n\n## Arrival\n\nFog.\n\n## Descent\n\nDark.")).toEqual([
      { role: "title", text: "The Hollow" },
      { role: "phase", text: "Arrival" },
      { role: "beat", text: "Fog." },
      { role: "phase", text: "Descent" },
      { role: "beat", text: "Dark." },
    ]);
  });

  it("treats screenplay scene headings as phases with a location", () => {
    expect(suggestRows("INT. CABIN - NIGHT\n\nThe fire is out.")).toEqual([
      { role: "phase", text: "INT. CABIN - NIGHT" },
      { role: "location", text: "INT. CABIN - NIGHT" },
      { role: "beat", text: "The fire is out." },
    ]);
  });

  it("reads chapters with roman numerals", () => {
    expect(suggestRows("Chapter IV – The Bog\nIt rains.")[0]).toEqual({
      role: "phase",
      text: "The Bog",
    });
  });

  it("drops a label repeated as a template marker across phases", () => {
    const text = [
      "ACT 1: One",
      "Events: A happens.",
      "Twist: B happens.",
      "ACT 2: Two",
      "Events: C happens.",
      "ACT 3: Three",
      "Events: D happens.",
    ].join("\n");
    expect(suggestRows(text).filter((row) => row.role === "beat")).toEqual([
      { role: "beat", text: "A happens." },
      { role: "beat", label: "Twist", text: "B happens." },
      { role: "beat", text: "C happens." },
      { role: "beat", text: "D happens." },
    ]);
  });
});
