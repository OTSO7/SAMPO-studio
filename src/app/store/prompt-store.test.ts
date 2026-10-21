import { describe, expect, it } from "vitest";

import { ask, createPromptConfirm, createPromptStore } from "./prompt-store";

describe("prompts", () => {
  it("shows a question and resolves with the chosen action", async () => {
    const store = createPromptStore();
    const answer = ask(store, {
      title: "T",
      message: "M",
      actions: [
        { label: "No", value: "no" },
        { label: "Yes", value: "yes" },
      ],
      cancelValue: "no",
    });

    store.getState().prompt?.resolve("yes");

    expect(await answer).toBe("yes");
    expect(store.getState().prompt).toBeNull();
  });

  it("cancels an unanswered question when a new one is asked", async () => {
    const store = createPromptStore();
    const first = ask(store, { title: "1", message: "", actions: [], cancelValue: "cancel" });
    void ask(store, { title: "2", message: "", actions: [], cancelValue: "cancel" });

    expect(await first).toBe("cancel");
    expect(store.getState().prompt?.title).toBe("2");
  });

  it("asks Save / Don't save / Cancel before closing", async () => {
    const store = createPromptStore();
    const confirm = createPromptConfirm(store);

    const choice = confirm.saveChanges("Routa.sampo");
    expect(store.getState().prompt?.actions.map((action) => action.label)).toEqual([
      "Don't save",
      "Cancel",
      "Save",
    ]);
    expect(store.getState().prompt?.message).toMatch(/Routa\.sampo/u);
    store.getState().prompt?.resolve("discard");

    expect(await choice).toBe("discard");
  });

  it("answers the discard question with a boolean", async () => {
    const prompts = createPromptStore();
    const confirm = createPromptConfirm(prompts);

    const discarded = confirm.discardChanges();
    prompts.getState().prompt?.resolve("discard");
    expect(await discarded).toBe(true);

    const kept = confirm.discardChanges();
    prompts.getState().prompt?.resolve("cancel");
    expect(await kept).toBe(false);
  });
});
