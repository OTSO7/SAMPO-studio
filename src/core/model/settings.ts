import type { Story } from "./story";

export type FocusLayout = "grid" | "list";

/**
 * Choices kept with the story, so they travel with its file to another computer. Only what
 * differs from the default is stored: a story with default settings has none at all, and its
 * file stays exactly as earlier versions wrote it.
 */
export interface StorySettings {
  /** Ask before anything cuts off the song that is playing. */
  readonly safeAudio?: true;
  /** Sound effects' volume from 0 to 1. */
  readonly sfxVolume?: number;
  readonly focusLayout?: "list";
}

/**
 * Below full: an effect at full level on top of a full-level song overloads the output, and
 * Windows then pushes the song down to make room.
 */
export const DEFAULT_SFX_VOLUME = 0.8;

/** Keeps what it recognises from any source, so a strange value never stops a story opening. */
export function readSettings(value: unknown): StorySettings | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { safeAudio, sfxVolume, focusLayout } = value as Record<string, unknown>;
  const volume =
    typeof sfxVolume === "number" && sfxVolume >= 0 && sfxVolume <= 1 ? sfxVolume : undefined;
  const settings: StorySettings = {
    ...(safeAudio === true ? { safeAudio } : {}),
    ...(volume === undefined || volume === DEFAULT_SFX_VOLUME ? {} : { sfxVolume: volume }),
    ...(focusLayout === "list" ? { focusLayout } : {}),
  };
  return Object.keys(settings).length === 0 ? undefined : settings;
}

export function setStorySettings(
  story: Story,
  change: {
    readonly safeAudio?: boolean;
    readonly sfxVolume?: number;
    readonly focusLayout?: FocusLayout;
  },
): Story {
  const settings = readSettings({ ...story.settings, ...change });
  const { settings: _old, ...rest } = story;
  return settings === undefined ? rest : { ...rest, settings };
}
