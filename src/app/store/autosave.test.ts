import { describe, expect, it } from "vitest";

import { sampleStory } from "@core/testing/sample-story";
import { startAutosave } from "./autosave";
import { createDocumentStore, editStory, isDirty, loadDocument } from "./document-store";
import { saveDocument } from "./save-document";
import { ControlledHost, ManualTimers, settle, storyFilesFor } from "./test-helpers";

const story = sampleStory();
const rename = (title: string) => (s: typeof story) => ({ ...s, title });

function setup(path: string | null = "D:/Routa.sampo") {
  const host = new ControlledHost();
  const timers = new ManualTimers();
  const store = createDocumentStore();
  loadDocument(store, story, path);
  const autosave = startAutosave(store, storyFilesFor(host), { delayMs: 2000, timers });
  return { host, timers, store, autosave };
}

describe("saves never overlap", () => {
  it("lets Ctrl+S wait for a running autosave instead of writing at the same time", async () => {
    const { host, timers, store } = setup();
    const files = storyFilesFor(host);
    host.holdWrites = true;

    editStory(store, rename("Ääni lisätty"));
    timers.fireAll();
    await settle();
    expect(host.writes).toHaveLength(1);

    const manual = saveDocument(store, files);
    await settle();
    // Still one write: the manual save waits for the autosave to finish.
    expect(host.writes).toHaveLength(1);

    host.releaseWrites();
    expect(await manual).toBe("saved");
    expect(host.writes).toHaveLength(1);
    expect(store.getState().saveStatus.kind).toBe("saved");
  });

  it("still writes edits made while the earlier save was running", async () => {
    const { host, store } = setup();
    const files = storyFilesFor(host);
    host.holdWrites = true;

    editStory(store, rename("Ensin"));
    const first = saveDocument(store, files);
    await settle();
    editStory(store, rename("Sitten"));
    const second = saveDocument(store, files);
    await settle();
    expect(host.writes).toHaveLength(1);

    host.holdWrites = false;
    host.releaseWrites();
    await first;
    expect(await second).toBe("saved");
    expect(host.writes).toHaveLength(2);
    expect(host.writes[1]?.contents).toMatch(/"title": "Sitten"/u);
    expect(isDirty(store.getState())).toBe(false);
  });
});

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

  it("pauses after finding the file changed by another program", async () => {
    const host = new ControlledHost();
    const timers = new ManualTimers();
    const store = createDocumentStore();
    const files = storyFilesFor(host);
    host.saveElsewhere("D:/Routa.sampo", "{}");
    await files.openPath("D:/Routa.sampo");
    loadDocument(store, story, "D:/Routa.sampo");
    startAutosave(store, files, { delayMs: 2000, timers });
    host.saveElsewhere("D:/Routa.sampo", "theirs");

    editStory(store, rename("Mine"));
    timers.fireAll();
    await settle();
    expect(store.getState().saveStatus).toEqual({ kind: "conflict" });

    editStory(store, rename("Mine 2"));
    timers.fireAll();
    await settle();
    expect(host.files.get("D:/Routa.sampo")).toBe("theirs");
  });

  it("stops listening when stopped", () => {
    const { timers, store, autosave } = setup();

    autosave.stop();
    editStory(store, rename("Routa 2"));

    expect(timers.scheduled).toEqual([]);
  });
});

describe("holding autosave", () => {
  it("waits while held and saves once released", async () => {
    const host = new ControlledHost();
    const timers = new ManualTimers();
    const store = createDocumentStore();
    loadDocument(store, story, "D:/Routa.sampo");
    let held = true;
    startAutosave(store, storyFilesFor(host), { delayMs: 2000, timers, holdWhile: () => held });

    editStory(store, rename("Keikka"));
    timers.fireAll();
    await settle();
    expect(host.writes).toHaveLength(0);

    held = false;
    timers.fireAll();
    await settle();
    expect(host.writes).toHaveLength(1);
  });
});
