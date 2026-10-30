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

  it("turns screenplay cues and quoted speech into lines on the card before them", () => {
    const script = [
      "Vaihe 1: Saapuminen",
      "Aatos herää laiturilta.",
      "AATOS: Missä minä olen?",
      "MUSTA ROUTA: Täällä.",
      'Mirja: "Älä liiku."',
      "Pelitapahtumat: Pelaaja oppii liikkumaan.",
    ].join("\n");

    expect(suggestRows(script)).toEqual([
      { role: "phase", text: "Saapuminen" },
      { role: "beat", text: "Aatos herää laiturilta." },
      { role: "line", speaker: "Aatos", text: "Missä minä olen?" },
      { role: "line", speaker: "Musta Routa", text: "Täällä." },
      { role: "line", speaker: "Mirja", text: '"Älä liiku."' },
      { role: "beat", label: "Pelitapahtumat", text: "Pelaaja oppii liikkumaan." },
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

  it("keeps a document with heading levels together: phases, cards and their text", () => {
    const rows = suggestRows(
      "# Pelin nimi\n\nOtto\n\n## Hahmot\n\nKaikki hahmot.\n\n### Aatos\n\nKonstaapeli.\n\nLuonne: hiljainen.\n\n• Kuiva huumori\n\n### Elias\n\nTaiteilija.\n\n## Maailma\n\nSuomi 1984.",
    );
    expect(rows).toEqual([
      { role: "title", text: "Pelin nimi" },
      { role: "text", text: "Otto" },
      { role: "phase", text: "Hahmot" },
      { role: "text", text: "Kaikki hahmot." },
      { role: "beat", label: "Aatos", text: "" },
      { role: "text", text: "Konstaapeli." },
      { role: "text", text: "Luonne: hiljainen." },
      { role: "text", text: "• Kuiva huumori" },
      { role: "beat", label: "Elias", text: "" },
      { role: "text", text: "Taiteilija." },
      { role: "phase", text: "Maailma" },
      { role: "text", text: "Suomi 1984." },
    ]);
  });

  it("finds the headings of a plain text document by their shape", () => {
    const rows = suggestRows(
      [
        "Design Document",
        "Lokakuu 2026",
        "Maailma",
        "Peli sijoittuu lokakuun 1984 Suomeen, jossa kylmä sota tuntuu kaikessa.",
        "Asia",
        "Kuvaus",
        "Lajityyppi",
        "Kauhu",
        "Tämä on pelin lupaus pelaajalle, ja se kannattaa pitää aina mielessä.",
        "Hahmot",
        "Aatos etsii, ja Elias on se, jota etsitään koko pelin ajan.",
        "Kolme pilaria:",
        "Kuva vetää menneisyyden nykyhetkeen ja paljastaa sen, mitä silmä ei näe.",
      ].join("\n"),
    );
    expect(rows.filter((row) => row.role === "beat").map((row) => row.label)).toEqual([
      "Maailma",
      "Hahmot",
      "Kolme pilaria",
    ]);
    expect(rows[0]).toEqual({ role: "title", text: "Design Document" });
    // The table's cells stay text on the card before them, not cards of their own.
    expect(rows.filter((row) => row.role === "text").map((row) => row.text)).toContain(
      "Lajityyppi",
    );
  });

  it("does not take a script for a document", () => {
    const script = [
      "Yö",
      "Kamera liukuu jäätyneen järven yli hitaasti kohti vanhaa saunaa rannalla.",
      "IRIS: Tulit takaisin.",
      "MATIAS: Oli pakko.",
      "Lyhty sammuu",
      "Sisällä höyry peittää seinät niin, ettei mitään näy ollenkaan.",
    ].join("\n");
    expect(suggestRows(script).some((row) => row.role === "beat" && row.text === "")).toBe(false);
  });
});
