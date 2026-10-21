import { describe, expect, it } from "vitest";

import { splitDialogue } from "./dialogue";

describe("splitDialogue", () => {
  it("returns plain prose as a single action", () => {
    expect(splitDialogue("Sumu nousee suolta.")).toEqual([
      { kind: "action", text: "Sumu nousee suolta." },
    ]);
  });

  it("separates the attribution sentence from preceding prose", () => {
    expect(
      splitDialogue('Aatos kuuntelee nauhan. Elias hourii hengästyneenä: "Askeleet..."'),
    ).toEqual([
      { kind: "action", text: "Aatos kuuntelee nauhan." },
      {
        kind: "line",
        speakerName: "Elias",
        direction: "hourii hengästyneenä",
        text: "Askeleet...",
      },
    ]);
  });

  it("supports multi-word speaker names", () => {
    expect(splitDialogue('Musta Routa kuiskaa: "Täällä."')).toEqual([
      { kind: "line", speakerName: "Musta Routa", direction: "kuiskaa", text: "Täällä." },
    ]);
  });

  it("does not treat initials as sentence boundaries", () => {
    expect(splitDialogue('Ovi aukeaa. E. Niemi sanoo: "Tervetuloa."')).toEqual([
      { kind: "action", text: "Ovi aukeaa." },
      { kind: "line", speakerName: "E. Niemi", direction: "sanoo", text: "Tervetuloa." },
    ]);
  });

  it("omits the direction when only a name precedes the colon", () => {
    expect(splitDialogue('Elias: "Hei."')).toEqual([
      { kind: "line", speakerName: "Elias", text: "Hei." },
    ]);
  });

  it("keeps an unknown speaker when the attribution has no name", () => {
    expect(splitDialogue('radiosta kuuluu: "Kohinaa."')).toEqual([
      { kind: "line", speakerName: null, direction: "radiosta kuuluu", text: "Kohinaa." },
    ]);
  });

  it("accepts typographic quotes", () => {
    expect(splitDialogue("Elias: ”Hei.”")).toEqual([
      { kind: "line", speakerName: "Elias", text: "Hei." },
    ]);
  });

  it("keeps prose that follows a line", () => {
    expect(splitDialogue('Elias: "Juokse!" Ovi paukahtaa kiinni.')).toEqual([
      { kind: "line", speakerName: "Elias", text: "Juokse!" },
      { kind: "action", text: "Ovi paukahtaa kiinni." },
    ]);
  });

  it("leaves unattributed quotations inside the prose", () => {
    expect(splitDialogue('Kyltissä lukee "E. Niemi". Elias: "Koti."')).toEqual([
      { kind: "action", text: 'Kyltissä lukee "E. Niemi".' },
      { kind: "line", speakerName: "Elias", text: "Koti." },
    ]);
  });

  it("drops punctuation left over after a closing quote", () => {
    expect(splitDialogue('Elias: "Hei".')).toEqual([
      { kind: "line", speakerName: "Elias", text: "Hei" },
    ]);
  });
});
