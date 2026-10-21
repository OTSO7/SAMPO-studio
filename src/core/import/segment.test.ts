import { describe, expect, it } from "vitest";

import { guessDialogue, segmentText, splitSentences, stripQuotes } from "./segment";

describe("segmentText", () => {
  it("returns one row per non-empty line", () => {
    expect(segmentText("Yksi\n\nKaksi\n   \nKolme")).toEqual(["Yksi", "Kaksi", "Kolme"]);
  });

  it("removes the invisible characters word processors add", () => {
    expect(segmentText("\u200BVAIHE 1: Alku\r\n\r\n\uFEFFTeksti\u00A0tässä")).toEqual([
      "VAIHE 1: Alku",
      "Teksti tässä",
    ]);
  });

  it("collapses repeated spaces and tabs", () => {
    expect(segmentText("Aatos \t  kävelee")).toEqual(["Aatos kävelee"]);
  });
});

describe("splitSentences", () => {
  it("splits on sentence ends", () => {
    expect(splitSentences("Sumu nousee. Ovi aukeaa! Kuka siellä?")).toEqual([
      "Sumu nousee.",
      "Ovi aukeaa!",
      "Kuka siellä?",
    ]);
  });

  it("keeps quotations whole", () => {
    expect(
      splitSentences('Aatos kuuntelee. Elias: "Askeleet. Ne eivät ole minun." Hiljaisuus.'),
    ).toEqual(["Aatos kuuntelee.", 'Elias: "Askeleet. Ne eivät ole minun."', "Hiljaisuus."]);
  });

  it("does not split after initials", () => {
    expect(splitSentences("Kyltissä lukee E. Niemi. Ovi on lukossa.")).toEqual([
      "Kyltissä lukee E. Niemi.",
      "Ovi on lukossa.",
    ]);
  });

  it("returns a single sentence unchanged", () => {
    expect(splitSentences("Musta ruutu")).toEqual(["Musta ruutu"]);
  });
});

describe("guessDialogue", () => {
  it("suggests speaker and text from an attributed quotation", () => {
    expect(guessDialogue('Elias hourii hengästyneenä: "Askeleet suolla..."')).toEqual({
      speaker: "Elias",
      text: "Askeleet suolla...",
    });
  });

  it("handles multi-word names and typographic quotes", () => {
    expect(guessDialogue("Musta Routa kuiskaa: “Täällä.”")).toEqual({
      speaker: "Musta Routa",
      text: "Täällä.",
    });
  });

  it("leaves the speaker empty when there is no attribution", () => {
    expect(guessDialogue('"Missä olet?"')).toEqual({ speaker: "", text: "Missä olet?" });
    expect(guessDialogue("Kuka siellä")).toEqual({ speaker: "", text: "Kuka siellä" });
  });
});

describe("stripQuotes", () => {
  it("removes quotes that wrap the whole text only", () => {
    expect(stripQuotes("“Hei.”")).toBe("Hei.");
    expect(stripQuotes('Kyltissä lukee "E. Niemi"')).toBe('Kyltissä lukee "E. Niemi"');
  });
});
