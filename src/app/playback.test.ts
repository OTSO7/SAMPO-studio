import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as Playback from "./playback";

/** Just enough of an audio element to drive the shared player, with failures on demand. */
class FakeAudio extends EventTarget {
  static last: FakeAudio | null = null;
  preload = "";
  src = "";
  currentTime = 0;
  duration = 240;
  paused = true;
  ended = false;
  failPlay = false;

  constructor() {
    super();
    FakeAudio.last = this;
  }

  play(): Promise<void> {
    if (this.failPlay) return Promise.reject(new Error("NotAllowedError"));
    this.paused = false;
    this.dispatchEvent(new Event("play"));
    this.dispatchEvent(new Event("playing"));
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }

  load(): void {
    this.dispatchEvent(new Event("loadedmetadata"));
  }

  removeAttribute(): void {
    this.src = "";
  }

  /** The decoder or the disk trips in the middle of the song. */
  fail(): void {
    this.paused = true;
    this.dispatchEvent(new Event("error"));
  }
}

let player: typeof Playback;

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("Audio", FakeAudio);
  player = await import("./playback");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const audio = () => {
  if (FakeAudio.last === null) throw new Error("no audio element yet");
  return FakeAudio.last;
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the shared player", () => {
  it("plays, pauses and resumes the same song", () => {
    player.togglePlay("asset://track.wav", "Intro");
    expect(player.isPlaying()).toBe(true);
    player.togglePlay("asset://track.wav", "Intro");
    expect(player.isPlaying()).toBe(false);
    player.togglePlay("asset://track.wav", "Intro");
    expect(player.isPlaying()).toBe(true);
    expect(player.playback.getState().label).toBe("Intro");
  });

  it("a failure mid-song gets one retry from the same spot, unheard", async () => {
    player.togglePlay("asset://track.wav", "Peak");
    audio().currentTime = 93;
    audio().dispatchEvent(new Event("timeupdate"));

    audio().fail();
    audio().dispatchEvent(new Event("loadedmetadata"));
    await settle();

    expect(player.isPlaying()).toBe(true);
    expect(audio().currentTime).toBe(93);
    expect(player.playback.getState().error).toBeNull();
  });

  it("keeps recovering from hiccups that come back later in the set", async () => {
    player.togglePlay("asset://track.wav", "Long");
    for (let hiccup = 0; hiccup < 5; hiccup++) {
      audio().fail();
      await settle();
      expect(player.isPlaying()).toBe(true);
    }
  });

  it("says so when a file truly cannot play, and nothing throws", async () => {
    player.togglePlay("asset://missing.wav", "Gone");
    audio().failPlay = true;
    audio().fail();
    await settle();

    expect(player.isPlaying()).toBe(false);
    expect(player.playback.getState().error).toMatch(/could not be played/u);
    // The next song still plays.
    audio().failPlay = false;
    player.togglePlay("asset://next.wav", "Next");
    expect(player.isPlaying()).toBe(true);
  });

  it("restart goes back to the start and keeps playing; stop clears everything", () => {
    player.togglePlay("asset://track.wav", "Outro");
    audio().currentTime = 120;
    player.restart();
    expect(audio().currentTime).toBe(0);
    expect(player.isPlaying()).toBe(true);

    player.stop();
    expect(player.isPlaying()).toBe(false);
    expect(player.playback.getState().url).toBeNull();
  });

  it("formats times the way the bar shows them", () => {
    expect(player.formatTime(83.4)).toBe("1:23");
    expect(player.formatTime(Number.NaN)).toBe("0:00");
  });
});
