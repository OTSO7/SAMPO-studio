import { useEffect } from "react";

import { resolveSaveConflict, type AppDeps } from "@app/commands";

/** Asks what to do as soon as a save, manual or automatic, finds the file changed on disk. */
export function useSaveConflict(deps: AppDeps): void {
  useEffect(
    () =>
      deps.document.subscribe((state, previous) => {
        if (state.saveStatus.kind === "conflict" && previous.saveStatus.kind !== "conflict") {
          void resolveSaveConflict(deps);
        }
      }),
    [deps],
  );
}
