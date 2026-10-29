import { describe, expect, it } from "vitest";

import { serializeStory } from "@core/file";
import { assembleStory } from "@core/import";
import { addBlock } from "@core/model";
import { FileError, type FileHost } from "./file-host";
import { StoryFiles, suggestedFileName } from "./story-files";

const story = assembleStory([
  { role: "title", text: "Routa: demo" },
  { role: "phase", text: "Alku" },
  { role: "line", speaker: "Elias", text: "Hei." },
]);
const NOW = new Date("2026-10-21T10:00:00.000Z");

/** In-memory host that answers dialogs from a script and records what was asked. */
class FakeHost implements FileHost {
  readonly files = new Map<string, string>();
  readonly suggestedNames: string[] = [];
  openAnswer: string | null = null;
  saveAnswer: string | null = null;

  pickOpenPath() {
    return Promise.resolve(this.openAnswer);
  }

  pickSavePath(suggestedName: string) {
    this.suggestedNames.push(suggestedName);
    return Promise.resolve(this.saveAnswer);
  }

  readText(path: string) {
    const contents = this.files.get(path);
    return contents === undefined
      ? Promise.reject(new FileError("not_found", `${path} does not exist`))
      : Promise.resolve(contents);
  }

  readonly packed = new Map<string, readonly string[]>();

  writeText(path: string, contents: string, media: readonly string[]) {
    this.files.set(path, contents);
    this.packed.set(path, media);
    this.modified.set(path, ++this.clock);
    return Promise.resolve();
  }

  readonly media = new Map<string, Blob>();

  async putMedia(file: Blob, extension: string) {
    const id = `${String(this.media.size).padStart(64, "0")}.${extension}`;
    this.media.set(id, file);
    return Promise.resolve(id);
  }

  missingMedia(ids: readonly string[]) {
    return Promise.resolve([...ids].filter(() => false));
  }

  mediaUrl(id: string) {
    return `asset://media/${id}`;
  }

  clock = 0;
  readonly modified = new Map<string, number>();

  modifiedAt(path: string) {
    return Promise.resolve(this.modified.get(path) ?? null);
  }

  exportAnswer: string | null = null;
  readonly exportNames: string[] = [];

  pickExportPath(suggestedName: string) {
    this.exportNames.push(suggestedName);
    return Promise.resolve(this.exportAnswer);
  }

  writeExport(path: string, contents: string) {
    this.files.set(path, contents);
    return Promise.resolve();
  }

  launchPath() {
    return Promise.resolve(null);
  }
}

function setup() {
  const host = new FakeHost();
  return { host, files: new StoryFiles(host, () => NOW) };
}

describe("StoryFiles media", () => {
  it("moves pictures stored inline by older versions into the package", async () => {
    const { host, files } = setup();
    const line = story.phases[0]?.beats[0];
    if (line === undefined) throw new Error("fixture changed");
    const withPicture = addBlock(story, line.id, {
      type: "image",
      src: "data:image/png;base64,iVBORw0KGgo=",
    }).story;
    host.files.set("D:/Vanha.sampo", serializeStory(withPicture));

    const opened = await files.openPath("D:/Vanha.sampo");
    if (opened.status !== "opened") throw new Error("did not open");
    const picture = opened.story.phases[0]?.beats[0]?.blocks.find((b) => b.type === "image");

    expect(picture?.type === "image" && picture.src).toBe(`media:${"0".repeat(64)}.png`);
    expect(files.mediaUrl(picture?.type === "image" ? picture.src : "")).toBe(
      `asset://media/${"0".repeat(64)}.png`,
    );

    await files.save(opened.story, "D:/Vanha.sampo");
    expect(host.packed.get("D:/Vanha.sampo")).toEqual([`${"0".repeat(64)}.png`]);
  });

  it("leaves addresses that are not packed files as they are", () => {
    const { files } = setup();
    expect(files.mediaUrl("data:image/webp;base64,AAAA")).toBe("data:image/webp;base64,AAAA");
  });
});

describe("StoryFiles.open", () => {
  it("reports cancellation without reading anything", async () => {
    const { files } = setup();
    expect(await files.open()).toEqual({ status: "cancelled" });
  });

  it("opens the picked story", async () => {
    const { host, files } = setup();
    host.files.set("D:/Tarinat/Routa.sampo", serializeStory(story));
    host.openAnswer = "D:/Tarinat/Routa.sampo";

    expect(await files.open()).toEqual({ status: "opened", path: "D:/Tarinat/Routa.sampo", story });
  });

  it("returns validation errors for a broken file", async () => {
    const { host, files } = setup();
    host.files.set("D:/rikki.sampo", "{}");

    const result = await files.openPath("D:/rikki.sampo");

    expect(result.status).toBe("invalid");
  });

  it("lets platform failures surface as FileError", async () => {
    const { files } = setup();
    let caught: unknown;
    try {
      await files.openPath("D:/puuttuu.sampo");
    } catch (error) {
      caught = error;
    }
    expect(caught instanceof FileError && caught.code).toBe("not_found");
  });
});

describe("StoryFiles.save", () => {
  it("writes to the known path without asking", async () => {
    const { host, files } = setup();

    expect(await files.save(story, "D:/Routa.sampo")).toEqual({
      status: "saved",
      path: "D:/Routa.sampo",
    });
    expect(host.suggestedNames).toEqual([]);
  });

  it("stamps the save time", async () => {
    const { host, files } = setup();
    await files.save(story, "D:/Routa.sampo");

    expect(JSON.parse(host.files.get("D:/Routa.sampo") ?? "{}")).toHaveProperty(
      "savedAt",
      NOW.toISOString(),
    );
  });

  it("asks for a path the first time, suggesting one from the title", async () => {
    const { host, files } = setup();
    host.saveAnswer = "D:/Routa - demo.sampo";

    expect(await files.save(story, null)).toEqual({
      status: "saved",
      path: "D:/Routa - demo.sampo",
    });
    expect(host.suggestedNames).toEqual(["Routa - demo.sampo"]);
  });

  it("adds the extension when the dialog leaves it out", async () => {
    const { host, files } = setup();
    host.saveAnswer = "D:/Routa";

    expect(await files.saveAs(story)).toEqual({ status: "saved", path: "D:/Routa.sampo" });
  });

  it("writes nothing when the user cancels", async () => {
    const { host, files } = setup();

    expect(await files.saveAs(story)).toEqual({ status: "cancelled" });
    expect(host.files.size).toBe(0);
  });

  it("refuses to overwrite a file another program saved since", async () => {
    const { host, files } = setup();
    await files.save(story, "D:/Routa.sampo");
    host.files.set("D:/Routa.sampo", "theirs");
    host.modified.set("D:/Routa.sampo", ++host.clock);

    let caught: unknown;
    try {
      await files.save(story, "D:/Routa.sampo");
    } catch (error) {
      caught = error;
    }

    expect(caught instanceof FileError && caught.code).toBe("changed_on_disk");
    expect(host.files.get("D:/Routa.sampo")).toBe("theirs");
  });

  it("overwrites another program's save when asked to", async () => {
    const { host, files } = setup();
    await files.save(story, "D:/Routa.sampo");
    host.modified.set("D:/Routa.sampo", ++host.clock);

    await files.save(story, "D:/Routa.sampo", true);
    expect(await files.save(story, "D:/Routa.sampo")).toEqual({
      status: "saved",
      path: "D:/Routa.sampo",
    });
  });

  it("writes a deleted file again instead of reporting a conflict", async () => {
    const { host, files } = setup();
    await files.save(story, "D:/Routa.sampo");
    host.files.delete("D:/Routa.sampo");
    host.modified.delete("D:/Routa.sampo");

    expect((await files.save(story, "D:/Routa.sampo")).status).toBe("saved");
  });

  it("round-trips through open", async () => {
    const { files } = setup();
    await files.save(story, "D:/Routa.sampo");

    expect(await files.openPath("D:/Routa.sampo")).toEqual({
      status: "opened",
      path: "D:/Routa.sampo",
      story,
    });
  });
});

describe("suggestedFileName", () => {
  it.each([
    ["Routa", "Routa.sampo"],
    ["Routa: demo slice", "Routa - demo slice.sampo"],
    ['A/B\\C*D?"E"', "A - B - C - D - - E.sampo"],
    ["  ...  ", "Untitled.sampo"],
    ["", "Untitled.sampo"],
  ])("turns %j into %j", (title, expected) => {
    expect(suggestedFileName(title)).toBe(expected);
  });
});

describe("StoryFiles.export", () => {
  it("suggests a name from the title and adds the extension", async () => {
    const { host, files } = setup();
    host.exportAnswer = "D:/Routa - voice lines";

    expect(await files.export("a,b\n", "Routa: voice lines", "csv")).toEqual({
      status: "exported",
      path: "D:/Routa - voice lines.csv",
    });
    expect(host.exportNames).toEqual(["Routa - voice lines.csv"]);
    expect(host.files.get("D:/Routa - voice lines.csv")).toBe("a,b\n");
  });

  it("writes nothing when cancelled", async () => {
    const { host, files } = setup();
    expect(await files.export("x", "Routa", "md")).toEqual({ status: "cancelled" });
    expect(host.files.size).toBe(0);
  });
});
