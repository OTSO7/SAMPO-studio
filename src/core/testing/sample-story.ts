import { assembleStory, type ImportRow } from "../import";
import { createIdFactory, type IdFactory, type IdSource, type Story } from "../model";

/** Ids that are the same on every run, for snapshot-style assertions. */
export function deterministicIds(): IdFactory {
  let time = 0;
  const source: IdSource = { now: () => time++, fillRandom: (bytes) => bytes.fill(0) };
  return createIdFactory(source);
}

/** A small invented story (not Routa: this repository is public) used across tests. */
export const SAMPLE_ROWS: readonly ImportRow[] = [
  { role: "title", text: "Majakka" },
  { role: "phase", text: "Saapuminen" },
  { role: "location", text: "Majakkasaari" },
  { role: "beat", text: "Mirja nousee laiturille. Sumu peittää saaren." },
  { role: "text", text: "Majakan valo on sammunut." },
  { role: "beat", text: "Mirja lukee vartijan päiväkirjaa." },
  { role: "line", speaker: "Vartija", text: "“Valo ei sammunut itsestään.”" },
  { role: "phase", text: "Torni" },
  { role: "location", text: "Kierreportaat" },
  { role: "beat", text: "Portaat jatkuvat meren alle." },
  { role: "line", speaker: "Mirja", text: "Tämä ei ole sama torni." },
  { role: "note", text: "Kuuluuko tässä sade?" },
];

export function sampleStory(ids: IdFactory = deterministicIds()): Story {
  return assembleStory(SAMPLE_ROWS, ids);
}
