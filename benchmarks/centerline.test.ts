import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { cpus, platform } from "node:os";
import sharp from "sharp";
import { expect, test } from "vitest";
import { traceCenterlines } from "../src/core/centerline";
import { serializeVectorDocument } from "../src/core/serialize";
import type { VectorDocument } from "../src/core/vectorDocument";
import {
  centerlineCorpus,
  centerlineOptions,
  measureCenterlines,
} from "../tests/fixtures/centerlineCorpus";

const pixelMask = (document: VectorDocument) => {
  const unitStroke = {
    ...document,
    shapes: document.shapes.map((shape) => ({ ...shape, strokeWidth: 1 })),
  };
  return sharp(Buffer.from(serializeVectorDocument(unitStroke)))
    .extractChannel("alpha")
    .raw()
    .toBuffer();
};

const withinOnePixel = (
  source: Buffer,
  target: Buffer,
  width: number,
  height: number,
) => {
  let count = 0;
  let matched = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] < 64) continue;
    count += 1;
    const x = index % width;
    const y = (index - x) / width;
    let nearby = false;
    for (let dy = -1; dy <= 1 && !nearby; dy += 1) {
      for (let dx = -1; dx <= 1 && !nearby; dx += 1) {
        if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height)
          continue;
        nearby = target[(y + dy) * width + x + dx] >= 64;
      }
    }
    matched += Number(nearby);
  }
  return matched / count;
};

test("measures centerline topology, distance and warmed trace time", async () => {
  const cases = await centerlineCorpus();
  const reports = cases.flatMap(({ name, image, reference, topology }) =>
    [false, true].map((optCurve) => {
      const run = () =>
        traceCenterlines(image.pixels, image.width, image.height, {
          ...centerlineOptions,
          optCurve,
        });
      for (let i = 0; i < 5; i += 1) run();
      const samples = Array.from({ length: 15 }, () => {
        const start = performance.now();
        run();
        return performance.now() - start;
      });
      const sorted = samples.slice().sort((a, b) => a - b);
      return {
        name,
        optCurve,
        width: image.width,
        height: image.height,
        inputSha256: createHash("sha256").update(image.pixels).digest("hex"),
        medianMs: sorted[7],
        samplesMs: samples,
        topology,
        ...measureCenterlines(run(), reference),
      };
    }),
  );
  const clean = cases.find(({ name }) => name === "mechanism-artwork")!.image;
  const grain = cases.find(({ name }) => name === "mechanism-grain")!.image;
  const mechanismGrainAgreement = await Promise.all(
    [false, true].map(async (optCurve) => {
      const mask = (image: typeof clean) =>
        pixelMask(
          traceCenterlines(image.pixels, image.width, image.height, {
            ...centerlineOptions,
            optCurve,
          }),
        );
      const [cleanMask, grainMask] = await Promise.all([
        mask(clean),
        mask(grain),
      ]);
      return {
        optCurve,
        grainToClean: withinOnePixel(
          grainMask,
          cleanMask,
          clean.width,
          clean.height,
        ),
        cleanToGrain: withinOnePixel(
          cleanMask,
          grainMask,
          clean.width,
          clean.height,
        ),
      };
    }),
  );
  const label = process.env.BENCH_LABEL || "current";
  const archiveScanInkAgreement = await Promise.all(
    cases
      .filter(({ name }) => name.endsWith("-patent-scan"))
      .flatMap(({ name, image: scan }) => {
        const scanInk = Buffer.alloc(scan.width * scan.height);
        for (let pixel = 0; pixel < scanInk.length; pixel += 1) {
          const i = pixel * 4;
          const luma =
            0.2126 * scan.pixels[i] +
            0.7152 * scan.pixels[i + 1] +
            0.0722 * scan.pixels[i + 2];
          scanInk[pixel] = luma < centerlineOptions.threshold ? 255 : 0;
        }
        return [false, true].map(async (optCurve) => {
          const traced = await pixelMask(
            traceCenterlines(scan.pixels, scan.width, scan.height, {
              ...centerlineOptions,
              optCurve,
            }),
          );
          return {
            name,
            optCurve,
            traceNearInk: withinOnePixel(
              traced,
              scanInk,
              scan.width,
              scan.height,
            ),
            inkNearTrace: withinOnePixel(
              scanInk,
              traced,
              scan.width,
              scan.height,
            ),
          };
        });
      }),
  );
  const report = JSON.stringify(
    {
      label,
      platform: platform(),
      cpu: cpus()[0]?.model,
      node: process.version,
      mechanismGrainAgreement,
      archiveScanInkAgreement,
      reports,
    },
    null,
    2,
  );
  await writeFile(
    new URL(`../results/centerline-${label}.json`, import.meta.url),
    `${report}\n`,
  );
  console.table(
    reports.map(
      ({
        name,
        optCurve,
        medianMs,
        tips,
        junctions,
        loops,
        tracedToSource,
        sourceToTraced,
      }) => ({
        name,
        curves: optCurve,
        ms: medianMs.toFixed(3),
        tips,
        junctions,
        loops,
        extraPx: tracedToSource?.mean.toFixed(3),
        missingPx: sourceToTraced?.mean.toFixed(3),
      }),
    ),
  );
  expect(reports).toHaveLength(cases.length * 2);
}, 120_000);
