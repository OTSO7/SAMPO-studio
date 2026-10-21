import { getCurrentWindow } from "@tauri-apps/api/window";

/** Fills the screen for presenting. Failing quietly is fine: focus mode still works windowed. */
export async function setFullscreen(on: boolean): Promise<void> {
  try {
    await getCurrentWindow().setFullscreen(on);
  } catch (error) {
    console.warn("Could not change fullscreen", error);
  }
}

/**
 * Asks `shouldClose` before the window closes; resolving `false` keeps it open.
 * Returns a function that removes the guard.
 */
export async function guardWindowClose(shouldClose: () => Promise<boolean>): Promise<() => void> {
  try {
    return await getCurrentWindow().onCloseRequested(async (event) => {
      if (!(await shouldClose())) event.preventDefault();
    });
  } catch (error) {
    console.warn("Could not guard window close", error);
    return () => undefined;
  }
}
