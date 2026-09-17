import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",   // the harness builds its own JSDOM per test
    include: ["tests/**/*.test.js"],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
