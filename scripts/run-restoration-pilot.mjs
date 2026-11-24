import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [
  destination,
  device = "cpu",
  reviewFile = "examples/training-data/real-scans/faint-manifest.json",
  ...extra
] = process.argv.slice(2);
if (!destination || extra.length || !["cpu", "cuda"].includes(device))
  throw new Error(
    "Usage: npm run restoration:pilot -- new-output-directory [cpu|cuda] [reviewed-manifest]",
  );

const repository = fileURLToPath(new URL("../", import.meta.url));
const output = path.resolve(destination);
const reviewed = path.resolve(reviewFile);
const sourceKey = (source) => {
  const url = new URL(source);
  return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`;
};
const qualificationDirectory = path.join(
  repository,
  "tests/fixtures/qualification",
);
const references = (
  await Promise.all(
    [
      "references.json",
      "fresh-references.json",
      "perimeter-references.json",
    ].map(async (file) =>
      JSON.parse(
        await readFile(path.join(qualificationDirectory, file), "utf8"),
      ),
    ),
  )
).flat();
const reservedSources = new Set(
  references.map(({ source }) => sourceKey(source)),
);
const reservedDigests = new Set(
  await Promise.all(
    references.map(async ({ id }) =>
      createHash("sha256")
        .update(await readFile(path.join(qualificationDirectory, `${id}.jpg`)))
        .digest("hex"),
    ),
  ),
);
const { scans } = JSON.parse(await readFile(reviewed, "utf8"));
for (const { source, sourceSha256 } of scans)
  if (
    reservedSources.has(sourceKey(source)) ||
    reservedDigests.has(sourceSha256)
  )
    throw new Error(
      `Reserved archival qualification source in reviewed manifest: ${source}`,
    );

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

run(python, ["scripts/scan-restoration.py", "audit-reviewed", reviewed]);
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
  reviewed,
]);
run(python, [
  "scripts/scan-restoration.py",
  "evaluate-reviewed",
  checkpoint,
  reviewed,
  path.join(output, "reviewed-validation.json"),
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
