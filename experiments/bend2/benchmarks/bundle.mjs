// Bundle the real SVG-X color primitives into one dependency-free ESM file so
// the worker_threads baseline runs the exact same algorithm as the app.
import { build } from "vite";

await build({
  configFile: false,
  root: process.cwd(),
  logLevel: "warn",
  build: {
    lib: {
      entry: "src/core/colorTrace.ts",
      formats: ["es"],
      fileName: "colorTrace",
    },
    outDir: "experiments/bend2/.build",
    emptyOutDir: true,
    minify: false,
    target: "node20",
    ssr: true,
  },
});
console.log("bundled src/core/colorTrace.ts -> experiments/bend2/.build/");
