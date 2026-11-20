import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { cpus, platform } from "node:os";
import sharp from "sharp";
import { expect, test } from "vitest";
import { traceCenterlines } from "../src/core/centerline";
import { serializeVectorDocument } from "../src/core/serialize";
import type { VectorDocument } from "../src/core/vectorDocument";
import {
  centerlineOptions,
  measureCenterlines,
} from "../tests/fixtures/centerlineCorpus";
import { scanLightingCorpus } from "../tests/fixtures/scanLightingCorpus";

const rasterizeStroke = async (document: VectorDocument) => {
  const shapes = document.shapes.map((shape) => ({ ...shape, strokeWidth: 1 }));
  return sharp(Buffer.from(serializeVectorDocument({ ...document, shapes })))
    .extractChannel("alpha")
    .raw()
    .toBuffer();
};

const agreement = (
  source: Buffer,
  target: Buffer,
  width: number,
  height: number,
) => {
  let total = 0;
  let matched = 0;
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] < 64) continue;
    total += 1;
    const x = i % width;
    const y = (i - x) / width;
    let near = false;
    for (
      let ny = Math.max(0, y - 1);
      ny <= Math.min(height - 1, y + 1) && !near;
      ny += 1
    ) {
      for (
        let nx = Math.max(0, x - 1);
        nx <= Math.min(width - 1, x + 1) && !near;
        nx += 1
      ) {
        near = target[ny * width + nx] >= 64;
      }
    }
    matched += Number(near);
  }
  return { total, matched, ratio: total ? matched / total : 0 };
};

test("measures faded-line retention, grain rejection and cost", async () => {
  const label = process.env.BENCH_LABEL || "current";
  const options = { ...centerlineOptions, normalizeScanLighting: true };
  const reports = [];
  for (const { name, clean, scan, distorted } of await scanLightingCorpus()) {
    const { width, height, pixels } = scan;
    const trace = () => traceCenterlines(pixels, width, height, options);
    for (let i = 0; i < 5; i += 1) trace();
    const samplesMs = Array.from({ length: 15 }, () => {
      const start = performance.now();
      trace();
      return performance.now() - start;
    });
    const document = trace();
    const cleanDocument = traceCenterlines(
      clean.image.pixels,
      width,
      height,
      centerlineOptions,
    );
    const [before, after] = await Promise.all([
      rasterizeStroke(cleanDocument),
      rasterizeStroke(document),
    ]);
    reports.push({
      name,
      distorted,
      width,
      height,
      inputSha256: createHash("sha256").update(pixels).digest("hex"),
      medianMs: samplesMs.slice().sort((a, b) => a - b)[7],
      samplesMs,
      referenceToTrace: agreement(before, after, width, height),
      traceToReference: agreement(after, before, width, height),
      ...measureCenterlines(document, clean.reference),
    });
  }
  await writeFile(
    new URL(`../results/scan-lighting-${label}.json`, import.meta.url),
    `${JSON.stringify({ label, platform: platform(), cpu: cpus()[0]?.model, node: process.version, reports }, null, 2)}\n`,
  );
  expect(reports).toHaveLength(10);
}, 120_000);
