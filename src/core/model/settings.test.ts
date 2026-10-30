import { describe, expect, it } from "vitest";

import { sampleStory } from "../testing/sample-story";
import { deserializeStory } from "../file/deserialize";
import { serializeStory } from "../file/serialize";
import { DEFAULT_SFX_VOLUME, readSettings, setStorySettings } from "./settings";

const story = sampleStory();

describe("story settings", () => {
  it("are saved in the file and come back", () => {
    const set = setStorySettings(story, { safeAudio: true, sfxVolume: 0.35, focusLayout: "list" });
    const loaded = deserializeStory(serializeStory(set));
    expect(loaded.ok && loaded.story.settings).toEqual({
      safeAudio: true,
      sfxVolume: 0.35,
      focusLayout: "list",
    });
  });

  it("add nothing to the file while they are the defaults", () => {
    const back = setStorySettings(setStorySettings(story, { safeAudio: true }), {
      safeAudio: false,
      sfxVolume: DEFAULT_SFX_VOLUME,
      focusLayout: "grid",
    });
    expect(back).toEqual(story);
    expect(serializeStory(back)).toBe(serializeStory(story));
    expect(serializeStory(back)).not.toContain("settings");
  });

  it("change one choice without touching the others", () => {
    const set = setStorySettings(story, { safeAudio: true, sfxVolume: 0.5 });
    expect(setStorySettings(set, { sfxVolume: 0.2 }).settings).toEqual({
      safeAudio: true,
      sfxVolume: 0.2,
    });
  });

  it("never stop a file opening: what is not understood is left out", () => {
    const file = JSON.parse(serializeStory(story)) as { story: Record<string, unknown> };
    file.story["settings"] = { safeAudio: "yes", sfxVolume: 40, focusLayout: "cube", future: 1 };
    const loaded = deserializeStory(JSON.stringify(file));
    expect(loaded.ok && loaded.story.settings).toBeUndefined();
    expect(readSettings("nonsense")).toBeUndefined();
    expect(readSettings(null)).toBeUndefined();
  });
});
