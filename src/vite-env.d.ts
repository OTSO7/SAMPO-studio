/// <reference types="vite/client" />

/** The app version from package.json, injected at build time. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** The live-session relay (cloud/); the default is the project's own. */
  readonly VITE_SAMPO_LIVE_URL?: string;
}
