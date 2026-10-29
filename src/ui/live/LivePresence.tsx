import { useEffect } from "react";

import { live, liveChanges, shareBlock, shareFocus, type Person } from "@app/live/project";
import { useStore } from "@ui/hooks/use-store";
import { personColor } from "./person-color";

const NOBODY: readonly Person[] = [];
const SAFE_ID = /^[\w-]+$/u;

/**
 * Shows where everyone else is, as in a shared document: the card each has open gets a ring
 * in their colour, the block they are typing in a bar and their name, and whatever they just
 * changed lights up for a moment. Also tells the session where this person is.
 */
export function LivePresence({ selectedId }: { selectedId: string | null }) {
  const people = useStore(live, (s) => (s.state.kind === "open" ? s.state.people : NOBODY));
  const changes = useStore(liveChanges, (s) => s);

  useEffect(() => {
    shareFocus(selectedId);
  }, [selectedId]);
  // Leaving the board (focus mode, closing the story) must not leave a stale ring on others' screens.
  useEffect(
    () => () => {
      shareFocus(null);
    },
    [],
  );

  // The text block with the cursor, wherever it is: the card panel, the script, focus mode.
  useEffect(() => {
    const report = () => {
      const block = document.activeElement?.closest("[data-block-id]");
      shareBlock(block?.getAttribute("data-block-id") ?? null);
    };
    const later = () => window.setTimeout(report, 0);
    document.addEventListener("focusin", report);
    document.addEventListener("focusout", later);
    return () => {
      document.removeEventListener("focusin", report);
      document.removeEventListener("focusout", later);
      shareBlock(null);
    };
  }, []);

  let rules = "";
  for (const person of people) {
    const color = personColor(person.peer);
    // Names come from other computers: only plain characters go into the stylesheet.
    const name = JSON.stringify(person.name.replace(/[^\p{L}\p{N} ._-]/gu, ""));
    const tag = `content:${name};position:absolute;padding:0 6px;border-radius:3px;font:500 10px/16px var(--font-ui);color:var(--ink);background:${color};pointer-events:none;z-index:1`;
    if (person.beatId !== null && SAFE_ID.test(person.beatId)) {
      // On the board, the threads wall and in focus mode alike.
      const card = `.card[data-beat-id="${person.beatId}"],.corkboard__card[data-pinned-card="${person.beatId}"],.focus-card[data-beat-id="${person.beatId}"]`;
      const tagged = card
        .split(",")
        .map((one) => `${one}::after`)
        .join(",");
      rules += `${card}{position:relative;box-shadow:0 0 0 2px ${color}}${tagged}{${tag};top:8px;right:10px}`;
    }
    if (person.blockId !== null && SAFE_ID.test(person.blockId)) {
      const block = `[data-block-id="${person.blockId}"]`;
      rules += `${block}{position:relative;box-shadow:inset 3px 0 0 ${color}!important;background:color-mix(in srgb,${color} 9%,transparent)!important;border-radius:var(--radius-sm)}${block}::after{${tag};top:-9px;right:6px}`;
    }
  }

  // Restarting a CSS animation needs a new name, so two alternate.
  const flash = changes.key % 2 === 0 ? "live-flash-a" : "live-flash-b";
  const editorOf = (id: string) => people.find((p) => p.blockId === id || p.beatId === id);
  for (const id of changes.ids) {
    if (!SAFE_ID.test(id)) continue;
    const who = editorOf(id);
    const color = who === undefined ? "var(--ochre)" : personColor(who.peer);
    rules += `.card[data-beat-id="${id}"],.focus-card[data-beat-id="${id}"],.corkboard__card[data-pinned-card="${id}"],[data-block-id="${id}"]{--live-flash:${color};animation:${flash} 1.4s var(--ease-out)}`;
  }

  return rules === "" ? null : <style>{rules}</style>;
}
