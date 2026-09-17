import globals from "globals";

/* The rules that matter for this refactor are no-undef and no-unused-vars.
 *
 * Bundling proves that every *import* resolves, but it says nothing about a
 * reference the author simply forgot to import: esbuild treats an unknown
 * name as a global and emits a bundle that fails only at runtime. no-undef
 * catches exactly that, which is the single most likely way for a module
 * extraction to break something silently.
 *
 * Style is deliberately not enforced -- this is a refactor of working code,
 * not a reformatting project. */
export default [
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }],
      "no-redeclare": "error",
      "no-dupe-keys": "error",
      "no-unreachable": "error",
    },
  },
  {
    files: ["tests/**/*.js", "tools/**/*.mjs", "vite.config.js", "vitest.config.js", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
    rules: { "no-undef": "error" },
  },
];
