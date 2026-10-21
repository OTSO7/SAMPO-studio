import { describe, expect, it } from "vitest";

import { parsePlainText } from "@core/parse";
import { FileError } from "../files";
import {
  createDocumentStore,
  editStory,
  isDirty,
  loadDocument,
  type DocumentState,
} from "./document-store";
import { saveDocument } from "./save-document";
import { ControlledHost, settle, storyFilesFor } from "./test-helpers";

const story = parsePlainText("VAIHE 1: Alku\n\nTeksti.", { title: "Routa" });
const rename = (title: string) => (s: typeof story) => ({ ...s, title });

describe("createStore", () => {
  it("notifies subscribers with the new and previous state", () => {
    const store = createDocumentStore();
    const seen: [DocumentState, DocumentState][] = [];
    store.subscribe((state, previous) => seen.push([state, previous]));

    loadDocument(store, story, "D:/Routa.sampo");

    expect(seen).toHaveLength(1);
    expect(seen[0]?.[1].story).toBeNull();
    expect(seen[0]?.[0].story).toBe(story);
  });

  it("stops notifying after unsubscribe", () => {
    const store = createDocumentStore();
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);

    unsubscribe();
    loadDocument(store, story, null);

    expect(calls).toBe(0);
  });
});

describe("document state", () => {
  it("treats an opened file as clean and an import as unsaved", () => {
    const store = createDocumentStore();

    loadDocument(store, story, "D:/Routa.sampo");
    expect(isDirty(store.getState())).toBe(false);

    loadDocument(store, story, null);
    expect(isDirty(store.getState())).toBe(true);
  });

  it("marks edits as unsaved", () => {
    const store = createDocumentStore();
    loadDocument(store, story, "D:/Routa.sampo");

    editStory(store, rename("Routa 2"));

    expect(store.getState().story?.title).toBe("Routa 2");
    expect(isDirty(store.getState())).toBe(true);
  });

  it("ignores edits when no story is open", () => {
    const store = createDocumentStore();
    editStory(store, rename("x"));
    expect(store.getState().revision).toBe(0);
  });
});

describe("saveDocument", () => {
  it("saves to the existing path and clears the dirty flag", async () => {
    const host = new ControlledHost();
    const store = createDocumentStore();
    loadDocument(store, story, "D:/Routa.sampo");
    editStory(store, rename("Routa 2"));

    expect(await saveDocument(store, storyFilesFor(host))).toBe("saved");

    expect(host.writes.map((write) => write.path)).toEqual(["D:/Routa.sampo"]);
    expect(isDirty(store.getState())).toBe(false);
    expect(store.getState().saveStatus.kind).toBe("saved");
  });

  it("asks for a path for a new story and remembers it", async () => {
    const host = new ControlledHost();
    host.saveAnswer = "D:/Uusi.sampo";
    const store = createDocumentStore();
    loadDocument(store, story, null);

    await saveDocument(store, storyFilesFor(host));

    expect(store.getState().path).toBe("D:/Uusi.sampo");
  });

  it("keeps the document dirty when the user cancels", async () => {
    const host = new ControlledHost();
    const store = createDocumentStore();
    loadDocument(store, story, null);

    expect(await saveDocument(store, storyFilesFor(host))).toBe("cancelled");

    expect(isDirty(store.getState())).toBe(true);
    expect(store.getState().saveStatus.kind).toBe("idle");
  });

  it("records failures instead of throwing", async () => {
    const host = new ControlledHost();
    host.failWith = new FileError("io", "Levy täynnä");
    const store = createDocumentStore();
    loadDocument(store, story, "D:/Routa.sampo");
    editStory(store, rename("Routa 2"));

    expect(await saveDocument(store, storyFilesFor(host))).toBe("failed");

    expect(store.getState().saveStatus).toEqual({ kind: "failed", message: "Levy täynnä" });
    expect(isDirty(store.getState())).toBe(true);
  });

  it("keeps edits made during the save marked as unsaved", async () => {
    const host = new ControlledHost();
    host.holdWrites = true;
    const store = createDocumentStore();
    loadDocument(store, story, "D:/Routa.sampo");
    editStory(store, rename("Ensimmäinen"));

    const saving = saveDocument(store, storyFilesFor(host));
    await settle();
    editStory(store, rename("Toinen"));
    host.releaseWrites();
    await saving;

    expect(isDirty(store.getState())).toBe(true);
    expect(store.getState().story?.title).toBe("Toinen");
  });

  it("does nothing without an open story", async () => {
    const host = new ControlledHost();
    expect(await saveDocument(createDocumentStore(), storyFilesFor(host))).toBe("nothing-to-save");
    expect(host.writes).toEqual([]);
  });
});
