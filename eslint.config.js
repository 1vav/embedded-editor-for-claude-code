import js from "@eslint/js";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import globals from "globals";

export default [
  { ignores: ["vendor/**", "node_modules/**"] },

  // Node.js: server, CLI, scripts
  {
    files: ["src/*.js", "bin/**/*.js", "scripts/**/*.mjs"],
    ...js.configs.recommended,
    languageOptions: {
      globals: { ...globals.node },
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-console": "off",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },

  // Browser: React/JSX SPA
  {
    files: ["src/viewer/**/*.{js,jsx}"],
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    languageOptions: {
      globals: { ...globals.browser },
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: "18" } },
    rules: {
      ...js.configs.recommended.rules,
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",        // React 17+ JSX transform
      "react/prop-types": "off",                // no TypeScript; prop-types would be noise
      "react-hooks/refs": "off",                // "latest ref" pattern (ref.current = cb) is intentional
      "react-hooks/set-state-in-effect": "off", // setLoading() at effect start is standard
      "react-hooks/exhaustive-deps": "warn",    // informative but not blocking; some omissions are intentional
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
];
