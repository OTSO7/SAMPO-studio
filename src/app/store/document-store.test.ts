import { describe, expect, it } from "vitest";

import { sampleStory } from "@core/testing/sample-story";
import { FileError } from "../files";
import {
  canRedo,
  canUndo,
  createDocumentStore,
  editStory,
  isDirty,
  loadDocument,
  redo,
  undo,
  type DocumentState,
} from "./document-store";
import { saveDocument } from "./save-document";
import { ControlledHost, settle, storyFilesFor } from "./test-helpers";

const story = sampleStory();
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

describe("undo and redo", () => {
  function opened() {
    const store = createDocumentStore();
    loadDocument(store, story, "D:/Routa.sampo");
    return store;
  }

  it("steps back and forward through edits", () => {
    const store = opened();
    editStory(store, rename("A"));
    editStory(store, rename("B"));

    undo(store);
    expect(store.getState().story?.title).toBe("A");
    undo(store);
    expect(store.getState().story?.title).toBe(story.title);
    expect(canUndo(store.getState())).toBe(false);

    redo(store);
    expect(store.getState().story?.title).toBe("A");
  });

  it("collapses edits in the same group into one step", () => {
    const store = opened();
    editStory(store, rename("R"), { group: "title" });
    editStory(store, rename("Ro"), { group: "title" });
    editStory(store, rename("Rou"), { group: "title" });

    undo(store);
    expect(store.getState().story?.title).toBe(story.title);
  });

  it("starts a new step when the group changes", () => {
    const store = opened();
    editStory(store, rename("A"), { group: "title" });
    editStory(store, rename("B"), { group: "other" });

    undo(store);
    expect(store.getState().story?.title).toBe("A");
  });

  it("clears redo after a new edit", () => {
    const store = opened();
    editStory(store, rename("A"));
    undo(store);
    editStory(store, rename("B"));
    expect(canRedo(store.getState())).toBe(false);
  });

  it("counts undo as a change that needs saving", () => {
    const store = opened();
    editStory(store, rename("A"));
    undo(store);
    expect(isDirty(store.getState())).toBe(true);
  });

  it("ignores edits that change nothing", () => {
    const store = opened();
    editStory(store, (s) => s);
    expect(canUndo(store.getState())).toBe(false);
    expect(isDirty(store.getState())).toBe(false);
  });

  it("forgets history when another story is loaded", () => {
    const store = opened();
    editStory(store, rename("A"));
    loadDocument(store, story, null);
    expect(canUndo(store.getState())).toBe(false);
  });
});
