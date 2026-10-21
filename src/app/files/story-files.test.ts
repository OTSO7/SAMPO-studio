import { describe, expect, it } from "vitest";

import { serializeStory } from "@core/file";
import { parsePlainText } from "@core/parse";
import { FileError, type FileHost } from "./file-host";
import { StoryFiles, suggestedFileName } from "./story-files";

const story = parsePlainText('VAIHE 1: Alku\n\nElias: "Hei."', { title: "Routa: demo" });
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

  writeText(path: string, contents: string) {
    this.files.set(path, contents);
    return Promise.resolve();
  }
}

function setup() {
  const host = new FakeHost();
  return { host, files: new StoryFiles(host, () => NOW) };
}

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
