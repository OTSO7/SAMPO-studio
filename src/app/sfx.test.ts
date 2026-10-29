import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as Sfx from "./sfx";

/** Records what Web Audio is asked to do; sources end only when told to. */
class FakeContext {
  static decodes = 0;
  static started = 0;
  static sources: FakeSource[] = [];
  state = "running";
  destination = {};
  createGain() {
    return { connect: () => undefined };
  }
  createBufferSource() {
    const source = new FakeSource();
    FakeContext.sources.push(source);
    return source;
  }
  decodeAudioData() {
    FakeContext.decodes++;
    return Promise.resolve({ duration: 0.3 });
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
}

class FakeSource extends EventTarget {
  buffer: unknown = null;
  stopped = false;
  connect() {
    return undefined;
  }
  start() {
    FakeContext.started++;
  }
  stop() {
    this.stopped = true;
    this.dispatchEvent(new Event("ended"));
  }
}

let sfx: typeof Sfx;

beforeEach(async () => {
  vi.resetModules();
  FakeContext.decodes = 0;
  FakeContext.started = 0;
  FakeContext.sources = [];
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(new Uint8Array(1000), { headers: { "content-length": "1000" } }),
      ),
    ),
  );
  sfx = await import("./sfx");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sound effects", () => {
  it("can be hammered: every hit starts it again, and it is only ever heard once", async () => {
    for (let hit = 0; hit < 10; hit++) await sfx.playSfx("asset://hit.wav");
    expect(FakeContext.started).toBe(10);
    expect(sfx.sfxVoices()).toBe(1);
    expect(FakeContext.sources.slice(0, 9).every((source) => source.stopped)).toBe(true);
    expect(FakeContext.sources[9]?.stopped).toBe(false);
  });

  it("restarts even when hits come faster than the first decode", async () => {
    await Promise.all(Array.from({ length: 10 }, () => sfx.playSfx("asset://hit.wav")));
    expect(sfx.sfxVoices()).toBe(1);
  });

  it("lets different effects sound together", async () => {
    await sfx.playSfx("asset://punch.wav");
    await sfx.playSfx("asset://crowd.wav");
    expect(sfx.sfxVoices()).toBe(2);
  });

  it("decodes each effect once, however often it is hit", async () => {
    for (let hit = 0; hit < 50; hit++) await sfx.playSfx("asset://hit.wav");
    expect(FakeContext.decodes).toBe(1);
  });

  it("never piles up more than 24 effects: the oldest makes room", async () => {
    for (let hit = 0; hit < 100; hit++) await sfx.playSfx(`asset://effect-${hit}.wav`);
    expect(FakeContext.started).toBe(100);
    expect(sfx.sfxVoices()).toBe(24);
    expect(FakeContext.sources.filter((source) => source.stopped)).toHaveLength(76);
  });

  it("forgets sounds that finished and can silence all at once", async () => {
    await sfx.playSfx("asset://a.wav");
    await sfx.playSfx("asset://b.wav");
    FakeContext.sources[0]?.stop();
    expect(sfx.sfxVoices()).toBe(1);
    sfx.stopAllSfx();
    expect(sfx.sfxVoices()).toBe(0);
  });

  it("leaves the music player alone", async () => {
    const playback = await import("./playback");
    await sfx.playSfx("asset://hit.wav");
    expect(playback.playback.getState().url).toBeNull();
  });

  it("stops one long effect on request, leaving the others and showing what still plays", async () => {
    await sfx.playSfx("asset://long.wav");
    await sfx.playSfx("asset://short.wav");
    expect(Object.keys(sfx.sfxPlaying.getState().hits).sort()).toEqual([
      "asset://long.wav",
      "asset://short.wav",
    ]);

    sfx.stopSfx("asset://long.wav");

    expect(FakeContext.sources[0]?.stopped).toBe(true);
    expect(FakeContext.sources[1]?.stopped).toBe(false);
    expect(Object.keys(sfx.sfxPlaying.getState().hits)).toEqual(["asset://short.wav"]);
    sfx.stopAllSfx();
    expect(sfx.sfxPlaying.getState().hits).toEqual({});
  });

  it("knows how long an effect is once decoded, for the progress bar", async () => {
    await sfx.playSfx("asset://hit.wav");
    expect(sfx.sfxLength("asset://hit.wav")).toBe(0.3);
  });
});
