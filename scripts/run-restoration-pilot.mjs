import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [destination, device = "cpu", ...extra] = process.argv.slice(2);
if (!destination || extra.length || !["cpu", "cuda"].includes(device))
  throw new Error(
    "Usage: npm run restoration:pilot -- new-output-directory [cpu|cuda]",
  );

const repository = fileURLToPath(new URL("../", import.meta.url));
const output = path.resolve(destination);
await mkdir(output);
const sources = path.join(output, "sources");
const dataset = path.join(output, "dataset");
const baseline = path.join(output, "synthetic");
const adapted = path.join(output, "adapted");
const baselineWeights = path.join(baseline, "ink-model.npz");
const checkpoint = path.join(adapted, "ink-model.npz");
const report = path.join(output, "archival.json");
const python = process.env.SVGX_RESTORATION_PYTHON || "python";
const run = (command, args, env = process.env) =>
  execFileSync(command, args, { cwd: repository, stdio: "inherit", env });

run(process.execPath, [
  "scripts/build-restoration-corpus.mjs",
  sources,
  dataset,
]);
run(process.execPath, ["scripts/audit-training-dataset.mjs", dataset]);
run(python, [
  "scripts/scan-restoration.py",
  "train",
  dataset,
  baseline,
  "--device",
  device,
]);
run(python, [
  "scripts/scan-restoration.py",
  "train",
  dataset,
  adapted,
  "--device",
  device,
  "--steps",
  "300",
  "--validate-every",
  "50",
  "--initialize",
  baselineWeights,
  "--reviewed",
  "examples/training-data/real-scans/manifest.json",
]);
run(python, [
  "scripts/scan-restoration.py",
  "evaluate-pairs",
  checkpoint,
  dataset,
  path.join(output, "procedural-holdout.json"),
]);
run(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "--config",
    "benchmarks/vitest.config.ts",
    "benchmarks/scanRestoration.test.ts",
  ],
  {
    ...process.env,
    SVGX_RESTORATION_CHECKPOINT: checkpoint,
    SVGX_RESTORATION_REPORT: report,
    SVGX_RESTORATION_PREVIEWS: path.join(output, "previews"),
  },
);
const evaluation = JSON.parse(await readFile(report, "utf8"));
console.log(
  JSON.stringify(
    { output, loops: evaluation.loops, qualified: evaluation.qualified },
    null,
    2,
  ),
);
