import { getCurrentWindow } from "@tauri-apps/api/window";

/** Fills the screen for presenting. Failing quietly is fine: focus mode still works windowed. */
export async function setFullscreen(on: boolean): Promise<void> {
  try {
    await getCurrentWindow().setFullscreen(on);
  } catch (error) {
    console.warn("Could not change fullscreen", error);
  }
}
