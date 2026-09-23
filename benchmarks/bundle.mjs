// Bundle the real SVG-X color primitives into one ESM file so the parallel
// prototype's workers run the exact same algorithm as the app.
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
    outDir: "benchmarks/.build",
    emptyOutDir: true,
    minify: false,
    target: "node20",
    ssr: true,
  },
});
console.log("bundled src/core/colorTrace.ts -> benchmarks/.build/");
