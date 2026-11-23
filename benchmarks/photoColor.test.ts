import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import sharp from "sharp";
import { expect, test } from "vitest";
import {
  assembleColorDocument,
  colorSeeds,
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
const sha256 = (input: string | Uint8Array) =>
  createHash("sha256").update(input).digest("hex");
const measure = (run: () => unknown) => {
  for (let warmup = 0; warmup < 3; warmup += 1) run();
  const samplesMs = Array.from({ length: 7 }, () => {
    const start = performance.now();
    run();
    return performance.now() - start;
  });
  const sorted = samplesMs.slice().sort((a, b) => a - b);
  return { medianMs: sorted[3], maxMs: sorted[6], samplesMs };
};

test("profiles photo conversion and checks serialized and rasterized output", async () => {
  const reports = [];
  for (const file of fixtures) {
    const { pixels, width, height } = await loadReal(file);
    const quantize = () =>
      quantizeColor(pixels, colorSeeds(pixels, benchOptions));
    const { labels, palette } = quantize();
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
        svgSha256: sha256(svg),
        rasterSha256: sha256(raster),
        assembly: measure(assemble),
        conversion: measure(conversion),
      });
    }
    reports.push({
      file,
      width,
      height,
      inputSha256: sha256(pixels),
      quantization: measure(quantize),
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
    const fidelity = ({ reports }: typeof report) =>
      reports.map(({ inputSha256, cases }) => ({
        inputSha256,
        output: cases.map(({ optCurve, paths, svgSha256, rasterSha256 }) => ({
          optCurve,
          paths,
          svgSha256,
          rasterSha256,
        })),
      }));
    expect(fidelity(report)).toEqual(fidelity(baseline));
  }
}, 180_000);
