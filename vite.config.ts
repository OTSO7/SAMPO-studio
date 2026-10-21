/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env["TAURI_DEV_HOST"];

const fromSrc = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url));

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],

  define: {
    // Set by pnpm from package.json when any script runs.
    __APP_VERSION__: JSON.stringify(process.env["npm_package_version"] ?? "dev"),
  },

  resolve: {
    alias: {
      "@core": fromSrc("core"),
      "@app": fromSrc("app"),
      "@ui": fromSrc("ui"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
    passWithNoTests: true,
  },
}));
