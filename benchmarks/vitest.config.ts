import { defineConfig } from "vitest/config";

// Isolated config for the pipeline benchmark harness. Root is the repository
// root (the invocation directory) and only benchmarks/ is discovered. Potrace is
// inlined exactly as the application's vitest.config.ts does.
export default defineConfig({
  ssr: {
    noExternal: ["@cadit-app/potrace-ts"],
  },
  server: {
    deps: {
      inline: ["@cadit-app/potrace-ts"],
    },
  },
  test: {
    environment: "node",
    root: process.cwd(),
    include: ["benchmarks/**/*.test.ts"],
  },
});
