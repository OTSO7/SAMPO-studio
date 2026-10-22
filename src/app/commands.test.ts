import { describe, expect, it } from "vitest";

import { serializeStory } from "@core/file";
import { sampleStory } from "@core/testing/sample-story";
import {
  closeStory,
  confirmWindowClose,
  exportStory,
  openStoryAt,
  openLaunchFile,
  importScript,
  newStory,
  openStory,
  resolveSaveConflict,
  save,
  type AppDeps,
  type ConflictChoice,
  type SaveChoice,
} from "./commands";
import { FileError } from "./files";
import { createRecentFiles, type KeyValueStorage } from "./recent-files";
import { createDocumentStore, createNoticeStore, editStory, isDirty, loadDocument } from "./store";
import { ControlledHost, storyFilesFor } from "./store/test-helpers";

const SCRIPT = "VAIHE 1: Alku\n\nAatos herää metsässä.";
const existing = sampleStory();

function setup({
  discard = true,
  choice = "save" as SaveChoice,
  conflict = "cancel" as ConflictChoice,
} = {}) {
  const host = new ControlledHost();
  const asked: string[] = [];
  const deps: AppDeps = {
    document: createDocumentStore(),
    notices: createNoticeStore(),
    files: storyFilesFor(host),
    confirm: {
      discardChanges: () => {
        asked.push("discard");
        return Promise.resolve(discard);
      },
      saveChanges: (name) => {
        asked.push(`save ${name}`);
        return Promise.resolve(choice);
      },
      fileChanged: (name) => {
        asked.push(`changed ${name}`);
        return Promise.resolve(conflict);
      },
    },
  };
  return { host, deps, asked };
}

describe("newStory", () => {
  it("opens an empty, unsaved story", async () => {
    const { deps } = setup();

    expect(await newStory(deps)).toBe(true);

    const state = deps.document.getState();
    expect(state.story?.title).toBe("Untitled");
    expect(state.story?.phases).toEqual([]);
    expect(state.path).toBeNull();
  });

  it("asks before discarding a story that was never saved", async () => {
    const { deps, asked } = setup({ discard: false });
    loadDocument(deps.document, existing, null);

    expect(await newStory(deps)).toBe(false);

    expect(asked).toEqual(["discard"]);
    expect(deps.document.getState().story).toBe(existing);
  });

  it("saves a file-backed story instead of asking", async () => {
    const { host, deps, asked } = setup();
    loadDocument(deps.document, existing, "D:/Routa.sampo");
    editStory(deps.document, (story) => ({ ...story, title: "Routa 2" }));

    expect(await newStory(deps)).toBe(true);

    expect(asked).toEqual([]);
    expect(host.writes.map((write) => write.path)).toEqual(["D:/Routa.sampo"]);
  });

  it("does not ask when nothing has changed", async () => {
    const { deps, asked } = setup();
    loadDocument(deps.document, existing, "D:/Routa.sampo");

    await newStory(deps);

    expect(asked).toEqual([]);
  });
});

describe("importScript", () => {
  it("drafts a story from pasted text", async () => {
    const { deps } = setup();

    expect(await importScript(deps, SCRIPT)).toBe(true);

    const state = deps.document.getState();
    expect(state.story?.phases.map((phase) => phase.title)).toEqual(["Alku"]);
    expect(state.story?.phases[0]?.beats).toHaveLength(1);
    expect(isDirty(state)).toBe(true);
  });

  it("ignores text with nothing to import", async () => {
    const { deps } = setup();
    expect(await importScript(deps, "  \u200B ")).toBe(false);
    expect(deps.document.getState().story).toBeNull();
  });

  it("asks before replacing a story that was never saved", async () => {
    const { deps, asked } = setup({ discard: false });
    loadDocument(deps.document, existing, null);

    expect(await importScript(deps, SCRIPT)).toBe(false);

    expect(asked).toEqual(["discard"]);
    expect(deps.document.getState().story).toBe(existing);
  });
});

describe("openStory", () => {
  it("loads the picked file", async () => {
    const { host, deps } = setup();
    host.openAnswer = "D:/Routa.sampo";
    host.files.set("D:/Routa.sampo", serializeStory(existing));

    expect(await openStory(deps)).toBe(true);

    expect(deps.document.getState().path).toBe("D:/Routa.sampo");
    expect(isDirty(deps.document.getState())).toBe(false);
  });

  it("explains why a file could not be opened", async () => {
    const { host, deps } = setup();
    host.openAnswer = "D:\\Tarinat\\rikki.sampo";
    host.files.set("D:\\Tarinat\\rikki.sampo", "{}");

    expect(await openStory(deps)).toBe(false);

    expect(deps.notices.getState().notice).toEqual({
      tone: "error",
      title: "Could not open rikki.sampo",
      details: ["This is not a SAMPO story file."],
    });
  });

  it("reports platform errors in plain words", async () => {
    const { host, deps } = setup();
    host.openAnswer = "D:/Puuttuu.sampo";

    await openStory(deps);

    expect(deps.notices.getState().notice?.title).toBe("File not found");
  });
});

describe("save", () => {
  it("reports failures as a notice", async () => {
    const { host, deps } = setup();
    host.failWith = new FileError("io", "Disk full");
    loadDocument(deps.document, existing, "D:/Routa.sampo");

    expect(await save(deps)).toBe(false);

    expect(deps.notices.getState().notice).toEqual({
      tone: "error",
      title: "Save failed",
      details: ["Disk full"],
    });
  });
});

describe("save conflicts", () => {
  async function openedThenChangedElsewhere(conflict: ConflictChoice) {
    const env = setup({ conflict });
    env.host.saveElsewhere("D:/Routa.sampo", serializeStory(existing));
    await openStoryAt(env.deps, "D:/Routa.sampo");
    editStory(env.deps.document, (s) => ({ ...s, title: "Mine" }));
    env.host.saveElsewhere("D:/Routa.sampo", serializeStory({ ...existing, title: "Theirs" }));
    return env;
  }

  it("does not overwrite another program's save", async () => {
    const { host, deps } = await openedThenChangedElsewhere("cancel");

    expect(await save(deps)).toBe(false);

    expect(deps.document.getState().saveStatus).toEqual({ kind: "conflict" });
    expect(host.files.get("D:/Routa.sampo")).toMatch(/"title": "Theirs"/u);
    expect(deps.notices.getState().notice).toBeNull();
  });

  it("keeps the user's version on Keep mine", async () => {
    const { host, deps, asked } = await openedThenChangedElsewhere("overwrite");
    await save(deps);

    expect(await resolveSaveConflict(deps)).toBe(true);

    expect(asked).toEqual(["changed Routa.sampo"]);
    expect(host.files.get("D:/Routa.sampo")).toMatch(/"title": "Mine"/u);
    expect(isDirty(deps.document.getState())).toBe(false);
  });

  it("loads the file from disk on Load from disk", async () => {
    const { deps } = await openedThenChangedElsewhere("reload");
    await save(deps);

    expect(await resolveSaveConflict(deps)).toBe(true);

    expect(deps.document.getState().story?.title).toBe("Theirs");
    expect(isDirty(deps.document.getState())).toBe(false);
  });
});

describe("closeStory", () => {
  it("closes without asking when nothing has changed", async () => {
    const { deps, asked } = setup();
    loadDocument(deps.document, existing, "D:/Routa.sampo");

    expect(await closeStory(deps)).toBe(true);

    expect(asked).toEqual([]);
    expect(deps.document.getState().story).toBeNull();
  });

  it("saves first when the user chooses Save", async () => {
    const { host, deps, asked } = setup({ choice: "save" });
    loadDocument(deps.document, existing, "D:/Tarinat/Routa.sampo");
    editStory(deps.document, (story) => ({ ...story, title: "Routa 2" }));

    expect(await closeStory(deps)).toBe(true);

    expect(asked).toEqual(["save Routa.sampo"]);
    expect(host.writes.map((write) => write.path)).toEqual(["D:/Tarinat/Routa.sampo"]);
    expect(deps.document.getState().story).toBeNull();
  });

  it("names a never-saved story by its title", async () => {
    const { deps, asked } = setup({ choice: "discard" });
    loadDocument(deps.document, existing, null);

    await closeStory(deps);

    expect(asked).toEqual([`save ${existing.title}`]);
  });

  it("throws the changes away when the user chooses Don't save", async () => {
    const { host, deps } = setup({ choice: "discard" });
    loadDocument(deps.document, existing, null);

    expect(await closeStory(deps)).toBe(true);

    expect(host.writes).toEqual([]);
    expect(deps.document.getState().story).toBeNull();
  });

  it("keeps the story open on Cancel", async () => {
    const { deps } = setup({ choice: "cancel" });
    loadDocument(deps.document, existing, null);

    expect(await closeStory(deps)).toBe(false);

    expect(deps.document.getState().story).toBe(existing);
  });

  it("keeps the story open when the save dialog is cancelled", async () => {
    const { deps } = setup({ choice: "save" });
    loadDocument(deps.document, existing, null);

    expect(await closeStory(deps)).toBe(false);

    expect(deps.document.getState().story).toBe(existing);
  });
});

describe("exportStory", () => {
  it("exports voice lines as CSV and reports how many", async () => {
    const { host, deps } = setup();
    host.exportAnswer = "D:/lines.csv";
    loadDocument(deps.document, existing, null);

    expect(await exportStory(deps, "voice-lines")).toBe(true);

    expect(host.files.get("D:/lines.csv")).toContain("VO_VARTIJA_");
    expect(deps.notices.getState().notice?.title).toBe("2 lines exported to lines.csv");
  });

  it("exports the script as Markdown", async () => {
    const { host, deps } = setup();
    host.exportAnswer = "D:/script";
    loadDocument(deps.document, existing, null);

    await exportStory(deps, "script");

    expect(host.files.get("D:/script.md")).toContain("# Majakka");
  });

  it("explains when there is no dialogue", async () => {
    const { deps } = setup();
    loadDocument(deps.document, { ...existing, phases: [] }, null);

    expect(await exportStory(deps, "voice-lines")).toBe(false);
    expect(deps.notices.getState().notice?.tone).toBe("info");
  });
});

describe("openLaunchFile", () => {
  it("opens the file the app was started with", async () => {
    const { host, deps } = setup();
    host.launch = "D:/Routa.sampo";
    host.files.set("D:/Routa.sampo", serializeStory(existing));

    expect(await openLaunchFile(deps)).toBe(true);
    expect(deps.document.getState().path).toBe("D:/Routa.sampo");
  });

  it("does nothing when started normally", async () => {
    const { deps } = setup();
    expect(await openLaunchFile(deps)).toBe(false);
    expect(deps.document.getState().story).toBeNull();
  });
});

function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe("confirmWindowClose", () => {
  it("lets the window close when nothing is unsaved", async () => {
    const { deps, asked } = setup();
    loadDocument(deps.document, existing, "D:/Routa.sampo");
    expect(await confirmWindowClose(deps)).toBe(true);
    expect(asked).toEqual([]);
  });

  it("saves a file-backed story quietly before closing", async () => {
    const { host, deps, asked } = setup();
    loadDocument(deps.document, existing, "D:/Routa.sampo");
    editStory(deps.document, (story) => ({ ...story, title: "Routa 2" }));

    expect(await confirmWindowClose(deps)).toBe(true);

    expect(asked).toEqual([]);
    expect(host.writes.map((write) => write.path)).toEqual(["D:/Routa.sampo"]);
  });

  it("asks before closing a story that was never saved", async () => {
    const { deps, asked } = setup({ choice: "cancel" });
    loadDocument(deps.document, existing, null);

    expect(await confirmWindowClose(deps)).toBe(false);
    expect(asked).toEqual([`save ${existing.title}`]);
  });

  it("closes after Don't save", async () => {
    const { deps } = setup({ choice: "discard" });
    loadDocument(deps.document, existing, null);
    expect(await confirmWindowClose(deps)).toBe(true);
  });
});

describe("recent files", () => {
  it("remembers files that were opened or saved", async () => {
    const { host, deps } = setup();
    const recent = createRecentFiles(memoryStorage());
    const withRecent = { ...deps, recent };
    host.files.set("D:/A.sampo", serializeStory(existing));
    host.saveAnswer = "D:/B.sampo";

    await openStoryAt(withRecent, "D:/A.sampo");
    await save(withRecent, { saveAs: true });

    expect(recent.list()).toEqual(["D:/B.sampo", "D:/A.sampo"]);
  });

  it("forgets a recent file that no longer exists", async () => {
    const { deps } = setup();
    const recent = createRecentFiles(memoryStorage());
    recent.add("D:/Gone.sampo");

    expect(await openStoryAt({ ...deps, recent }, "D:/Gone.sampo")).toBe(false);

    expect(recent.list()).toEqual([]);
    expect(deps.notices.getState().notice?.title).toBe("File not found");
  });
});
