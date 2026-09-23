import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Isolated config for the Bend 2 experiment. Root is the repository root so
// that the harness can import SVG-X sources directly.
export default defineConfig({
  root: fileURLToPath(new URL("../../..", import.meta.url)),
  test: {
    environment: "node",
    include: ["experiments/bend2/benchmarks/**/*.test.ts"],
  },
});
