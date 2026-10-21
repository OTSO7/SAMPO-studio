import { describe, expect, it } from "vitest";

import { parsePlainText } from "@core/parse";
import { startAutosave } from "./autosave";
import { createDocumentStore, editStory, isDirty, loadDocument } from "./document-store";
import { ControlledHost, ManualTimers, settle, storyFilesFor } from "./test-helpers";

const story = parsePlainText("VAIHE 1: Alku\n\nTeksti.", { title: "Routa" });
const rename = (title: string) => (s: typeof story) => ({ ...s, title });

function setup(path: string | null = "D:/Routa.sampo") {
  const host = new ControlledHost();
  const timers = new ManualTimers();
  const store = createDocumentStore();
  loadDocument(store, story, path);
  const autosave = startAutosave(store, storyFilesFor(host), { delayMs: 2000, timers });
  return { host, timers, store, autosave };
}

describe("startAutosave", () => {
  it("saves a short while after an edit", async () => {
    const { host, timers, store } = setup();

    editStory(store, rename("Routa 2"));
    expect(timers.scheduled).toEqual([2000]);
    expect(host.writes).toEqual([]);

    timers.fireAll();
    await settle();

    expect(host.writes).toHaveLength(1);
    expect(isDirty(store.getState())).toBe(false);
  });

  it("restarts the delay on every edit, so typing does not trigger saves", async () => {
    const { host, timers, store } = setup();

    editStory(store, rename("R"));
    editStory(store, rename("Ro"));
    editStory(store, rename("Rou"));

    expect(timers.scheduled).toHaveLength(1);
    timers.fireAll();
    await settle();
    expect(host.writes).toHaveLength(1);
  });

  it("never autosaves a story that has no file yet", () => {
    const { timers, store } = setup(null);

    editStory(store, rename("Uusi"));

    expect(timers.scheduled).toEqual([]);
  });

  it("does not overlap saves and picks up edits made during one", async () => {
    const { host, timers, store } = setup();
    host.holdWrites = true;

    editStory(store, rename("Ensimmäinen"));
    timers.fireAll();
    await settle();
    expect(host.writes).toHaveLength(1);

    editStory(store, rename("Toinen"));
    timers.fireAll();
    await settle();
    expect(host.writes).toHaveLength(1);

    host.releaseWrites();
    await settle();
    expect(timers.scheduled).toEqual([2000]);

    host.holdWrites = false;
    timers.fireAll();
    await settle();
    expect(host.writes).toHaveLength(2);
    expect(host.writes[1]?.contents).toMatch(/"title": "Toinen"/u);
    expect(isDirty(store.getState())).toBe(false);
  });

  it("flushes pending changes immediately", async () => {
    const { host, timers, store, autosave } = setup();

    editStory(store, rename("Routa 2"));
    await autosave.flush();

    expect(host.writes).toHaveLength(1);
    expect(timers.scheduled).toEqual([]);
  });

  it("stops listening when stopped", () => {
    const { timers, store, autosave } = setup();

    autosave.stop();
    editStory(store, rename("Routa 2"));

    expect(timers.scheduled).toEqual([]);
  });
});
