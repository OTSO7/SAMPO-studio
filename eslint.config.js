import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "src-tauri", "coverage"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.strict, ...tseslint.configs.stylistic],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      eqeqeq: ["error", "smart"],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["src/core/**/*.ts"],
    rules: {
      // core stays framework-free: no React, no Tauri, no DOM side effects.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["react", "react-*"], message: "core must not depend on React." },
            { group: ["@tauri-apps/*"], message: "core must not depend on Tauri." },
            { group: ["@app/*", "@ui/*"], message: "core must not import from upper layers." },
          ],
        },
      ],
    },
  },
  prettier,
);
