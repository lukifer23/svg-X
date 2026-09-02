import { defineConfig } from "vitest/config";

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
    include: ["src/**/*.test.ts", "src/**/*.bench.test.ts"],
  },
});
