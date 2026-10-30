import type { KeyboardEvent } from "react";

import { isPlaying, playback, restart, stop, togglePlay } from "@app/playback";
import { ask } from "@app/store";
import { useServices } from "@ui/services/use-services";

/** Space and Enter press this player's button; they must not also turn the page in focus mode. */
export function keepKeysHere(event: KeyboardEvent): void {
  if (event.key === " " || event.key === "Enter") event.stopPropagation();
}

/**
 * The player's buttons. In the story's safe audio mode, anything that would cut off the song that
 * is playing asks first, with "Keep playing" as the answer Enter, Space and Esc give. Pausing
 * never asks: the same button brings the song straight back.
 */
export function usePlayerActions() {
  const { prompts, deps } = useServices();

  const careful = async (title: string, message: string, confirm: string, action: () => void) => {
    if (isPlaying() && deps.document.getState().story?.settings?.safeAudio === true) {
      const choice = await ask(prompts, {
        title,
        message,
        actions: [
          { label: confirm, value: "go" },
          { label: "Keep playing", value: "keep", tone: "primary" },
        ],
        cancelValue: "keep",
      });
      if (choice !== "go") return;
    }
    action();
  };

  return {
    play: (url: string, label: string) => {
      if (playback.getState().url === url) {
        togglePlay(url, label);
        return;
      }
      void careful(
        "Switch song?",
        `“${playback.getState().label}” is playing. It will stop and “${label}” starts.`,
        "Stop and switch",
        () => {
          togglePlay(url, label);
        },
      );
    },
    restart: () => {
      void careful(
        "Back to the start?",
        "The song is playing. It will jump back to the beginning.",
        "Back to the start",
        restart,
      );
    },
    stop: () => {
      void careful("Stop the song?", "The song is playing. It will stop.", "Stop", stop);
    },
  };
}
