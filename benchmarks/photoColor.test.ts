import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { Session } from "node:inspector/promises";
import { cpus } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { expect, test } from "vitest";
import {
  assembleColorDocument,
  colorSeeds,
  findLabelComponents,
  mergeComponentsToBudget,
  quantizeColor,
  traceColorDocument,
} from "../src/core/colorTrace";
import { traceColorBoundaries } from "../src/core/colorBoundaries";
import { serializeVectorDocument } from "../src/core/serialize";
import { benchOptions, loadReal } from "./support";

const fixtures = [
  "realistic-still-life.png",
  "usda-fresh-produce.jpg",
  "usfws-rufous-hummingbird.jpg",
];

const loadFixture = async (file: string, workingSize: boolean) => {
  if (!workingSize) return loadReal(file);
  // Match the corrected-palette fidelity comparison's working raster.
  const { data, info } = await sharp(
    fileURLToPath(new URL(`../tests/fixtures/review/${file}`, import.meta.url)),
  )
    .resize(1000, 1000, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "white" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    pixels: new Uint8ClampedArray(data),
    width: info.width,
    height: info.height,
  };
};
const sha256 = (input: string | Uint8Array) =>
  createHash("sha256").update(input).digest("hex");
const measure = (run: () => unknown) => {
  if (process.env.SVGX_PHOTO_HASH_ONLY === "1") return;
  for (let warmup = 0; warmup < 3; warmup += 1) run();
  const samplesMs = Array.from({ length: 7 }, () => {
    const start = performance.now();
    run();
    return performance.now() - start;
  });
  const sorted = samplesMs.slice().sort((a, b) => a - b);
  return { medianMs: sorted[3], maxMs: sorted[6], samplesMs };
};

const profile = async (directory: string, file: string, run: () => unknown) => {
  const session = new Session();
  session.connect();
  try {
    await session.post("Profiler.enable");
    await session.post("Profiler.setSamplingInterval", { interval: 500 });
    await session.post("Profiler.start");
    for (let iteration = 0; iteration < 3; iteration += 1) run();
    const { profile } = await session.post("Profiler.stop");
    await writeFile(
      path.join(directory, `${file}.cpuprofile`),
      JSON.stringify(profile),
    );
  } finally {
    session.disconnect();
  }
};

test("profiles photo conversion and checks serialized and rasterized output", async () => {
  const reports = [];
  const workingSize = process.env.SVGX_PHOTO_WORKING_SIZE === "1";
  for (const file of workingSize
    ? ["color-bicycle.png", ...fixtures]
    : fixtures) {
    const { pixels, width, height } = await loadFixture(file, workingSize);
    const quantize = () =>
      quantizeColor(pixels, colorSeeds(pixels, benchOptions));
    const { labels, palette } = quantize();
    const quantization = measure(quantize);
    if (process.env.SVGX_PHOTO_PROFILE_DIR)
      await profile(
        process.env.SVGX_PHOTO_PROFILE_DIR,
        `${file}.quantize`,
        quantize,
      );
    const merge = () =>
      mergeComponentsToBudget(
        labels,
        width,
        height,
        palette,
        benchOptions.maxPaths,
        benchOptions.turdSize,
      );
    const merged = merge();
    if (process.env.SVGX_PHOTO_PROFILE_DIR)
      await profile(process.env.SVGX_PHOTO_PROFILE_DIR, `${file}.merge`, merge);
    const boundaries = measure(() => {
      traceColorBoundaries(merged.labels, width, height, palette.length);
    });
    const cases = [];
    for (const optCurve of [false, true]) {
      const options = { ...benchOptions, optCurve };
      const assemble = () =>
        assembleColorDocument(labels, palette, width, height, options);
      const conversion = () =>
        traceColorDocument(pixels, width, height, options);
      const document = conversion();
      const svg = serializeVectorDocument(document);
      const raster = await sharp(Buffer.from(svg))
        .ensureAlpha()
        .raw()
        .toBuffer();
      cases.push({
        optCurve,
        paths: document.diagnostics?.outputPaths,
        geometrySha256: sha256(JSON.stringify(document)),
        svgSha256: sha256(svg),
        svgBytes: Buffer.byteLength(svg),
        rasterSha256: sha256(raster),
        assembly: measure(assemble),
        conversion: measure(conversion),
      });
      if (optCurve && process.env.SVGX_PHOTO_PROFILE_DIR)
        await profile(process.env.SVGX_PHOTO_PROFILE_DIR, file, assemble);
    }
    reports.push({
      file,
      width,
      height,
      inputSha256: sha256(pixels),
      labelsSha256: sha256(labels),
      paletteSha256: sha256(JSON.stringify(palette)),
      mergedLabelsSha256: sha256(merged.labels),
      componentDiscovery: workingSize
        ? measure(() => findLabelComponents(labels, width, height))
        : undefined,
      quantization,
      componentMerge: measure(merge),
      boundaries,
      cases,
    });
  }

  const results = new URL("../results/", import.meta.url);
  const label = process.env.BENCH_LABEL ?? "local";
  const report = {
    label,
    platform: process.platform,
    cpu: cpus()[0]?.model.trim(),
    node: process.version,
    options: benchOptions,
    reports,
  };
  await writeFile(
    new URL(`photo-color-${label}.json`, results),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  if (process.env.SVGX_PHOTO_BASELINE) {
    const baseline = JSON.parse(
      await readFile(new URL(process.env.SVGX_PHOTO_BASELINE, results), "utf8"),
    );
    const compareGeometry = baseline.reports.every(
      ({ cases }: (typeof report.reports)[number]) =>
        cases.every(({ geometrySha256 }) => geometrySha256),
    );
    const compareQuantization = baseline.reports.every(
      ({ labelsSha256, paletteSha256 }: (typeof report.reports)[number]) =>
        labelsSha256 && paletteSha256,
    );
    const compareMerged = baseline.reports.every(
      ({ mergedLabelsSha256 }: (typeof report.reports)[number]) =>
        mergedLabelsSha256,
    );
    const compareSize = baseline.reports.every(
      ({ cases }: (typeof report.reports)[number]) =>
        cases.every(({ svgBytes }) => Number.isInteger(svgBytes)),
    );
    const fidelity = ({ reports }: typeof report) =>
      reports.map(
        ({
          inputSha256,
          labelsSha256,
          paletteSha256,
          mergedLabelsSha256,
          cases,
        }) => ({
          inputSha256,
          ...(compareQuantization ? { labelsSha256, paletteSha256 } : {}),
          ...(compareMerged ? { mergedLabelsSha256 } : {}),
          output: cases.map(
            ({
              optCurve,
              paths,
              svgSha256,
              svgBytes,
              rasterSha256,
              geometrySha256,
            }) => ({
              optCurve,
              paths,
              svgSha256,
              ...(compareSize ? { svgBytes } : {}),
              rasterSha256,
              ...(compareGeometry ? { geometrySha256 } : {}),
            }),
          ),
        }),
      );
    expect(fidelity(report)).toEqual(fidelity(baseline));
  }
}, 180_000);
