import { useCallback, useEffect } from "react";

import { showNotice } from "@app/store";
import { addBlock, type BeatId, type Story } from "@core/model";
import { useServices } from "@ui/services/use-services";
import { imageFiles, readImage } from "./images";

type Edit = (recipe: (story: Story) => Story, group?: string) => void;
export type AddImages = (beatId: BeatId, files: readonly File[], index?: number) => void;

/** Adds pictures to a card as one undo step, from `index` on (default: the end). */
export function useAddImages(edit: Edit): AddImages {
  const { notices } = useServices().deps;

  return useCallback(
    (beatId, files, index) => {
      void Promise.allSettled(files.map(readImage)).then((results) => {
        const sources = results.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        );
        if (sources.length > 0) {
          edit((story) =>
            sources.reduce(
              (current, src, i) =>
                addBlock(
                  current,
                  beatId,
                  { type: "image", src },
                  index === undefined ? undefined : index + i,
                ).story,
              story,
            ),
          );
        }
        const failed = results.length - sources.length;
        if (failed > 0) {
          showNotice(notices, {
            tone: "error",
            title: failed === 1 ? "Could not read the image" : `Could not read ${failed} images`,
          });
        }
      });
    },
    [edit, notices],
  );
}

const DROP_TARGETS = ".card[data-beat-id], .focus-card[data-beat-id], .inspector";

/**
 * Pictures dragged in from Explorer land on the card under the pointer, or on the open card
 * when dropped on the inspector. A pasted picture goes to the open card.
 */
export function useImageInput(add: AddImages, openBeatId: BeatId | null): void {
  useEffect(() => {
    let target: Element | null = null;
    const mark = (next: Element | null) => {
      if (next === target) return;
      target?.classList.remove("is-drop-target");
      target = next;
      target?.classList.add("is-drop-target");
    };
    const beatOf = (element: Element | null): BeatId | null =>
      element?.classList.contains("inspector") === true
        ? openBeatId
        : ((element?.getAttribute("data-beat-id") as BeatId | null | undefined) ?? null);
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") === true;

    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event) || event.dataTransfer === null) return;
      const element = event.target instanceof Element ? event.target.closest(DROP_TARGETS) : null;
      const accepts = beatOf(element) !== null;
      event.dataTransfer.dropEffect = accepts ? "copy" : "none";
      mark(accepts ? element : null);
    };
    const onDragLeave = (event: DragEvent) => {
      // Leaving the window, not just moving between elements inside it.
      if (event.relatedTarget === null) mark(null);
    };
    const onDrop = (event: DragEvent) => {
      const beatId = beatOf(target);
      mark(null);
      if (!hasFiles(event) || beatId === null) return;
      const files = imageFiles(event.dataTransfer?.files);
      if (files.length > 0) add(beatId, files);
    };
    const onPaste = (event: ClipboardEvent) => {
      // The script editor handles pastes inside it, at the cursor.
      if (event.defaultPrevented || openBeatId === null) return;
      const files = imageFiles(event.clipboardData?.files);
      if (files.length === 0) return;
      event.preventDefault();
      add(openBeatId, files);
    };

    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("paste", onPaste);
    return () => {
      mark(null);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("paste", onPaste);
    };
  }, [add, openBeatId]);
}
