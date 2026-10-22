import { getCurrentWindow } from "@tauri-apps/api/window";

/** The app draws its own title bar, so it also provides the window buttons. */
export async function minimizeWindow(): Promise<void> {
  try {
    await getCurrentWindow().minimize();
  } catch (error) {
    console.warn("Could not minimize", error);
  }
}

export async function toggleMaximized(): Promise<void> {
  try {
    await getCurrentWindow().toggleMaximize();
  } catch (error) {
    console.warn("Could not maximize", error);
  }
}

/** Goes through the close guard, so unsaved work is still saved or asked about. */
export async function closeWindow(): Promise<void> {
  try {
    await getCurrentWindow().close();
  } catch (error) {
    console.warn("Could not close", error);
  }
}

/** Calls `onChange` with the maximized state now and whenever the window is resized. */
export async function watchMaximized(onChange: (maximized: boolean) => void): Promise<() => void> {
  try {
    const window = getCurrentWindow();
    onChange(await window.isMaximized());
    return await window.onResized(() => {
      void window.isMaximized().then(onChange);
    });
  } catch {
    // Outside the desktop app there is no window to watch.
    return () => undefined;
  }
}

/** Fills the screen for presenting. Failing quietly is fine: focus mode still works windowed. */
export async function setFullscreen(on: boolean): Promise<void> {
  try {
    await getCurrentWindow().setFullscreen(on);
  } catch (error) {
    console.warn("Could not change fullscreen", error);
  }
}

/** Full screen hides the taskbar, as in a presentation or a focused editing session. */
export async function toggleFullscreen(): Promise<void> {
  try {
    const window = getCurrentWindow();
    await window.setFullscreen(!(await window.isFullscreen()));
  } catch (error) {
    console.warn("Could not toggle fullscreen", error);
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
