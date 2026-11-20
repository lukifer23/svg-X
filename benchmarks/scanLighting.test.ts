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

const enclosedRegions = (stroke: Buffer, width: number, height: number) => {
  const labels = new Int32Array(stroke.length);
  const areas = [0];
  const queue: number[] = [];
  for (let start = 0; start < stroke.length; start += 1) {
    if (stroke[start] >= 64 || labels[start]) continue;
    const id = areas.length;
    queue.length = 0;
    queue.push(start);
    labels[start] = id;
    let frame = false;
    const offer = (pixel: number) => {
      if (!labels[pixel] && stroke[pixel] < 64) {
        labels[pixel] = id;
        queue.push(pixel);
      }
    };
    for (let i = 0; i < queue.length; i += 1) {
      const pixel = queue[i];
      const x = pixel % width;
      const y = (pixel - x) / width;
      frame ||= x === 0 || y === 0 || x + 1 === width || y + 1 === height;
      if (x > 0) offer(pixel - 1);
      if (x + 1 < width) offer(pixel + 1);
      if (y > 0) offer(pixel - width);
      if (y + 1 < height) offer(pixel + width);
    }
    areas.push(!frame && queue.length >= 4 ? queue.length : 0);
  }
  return { labels, areas };
};

const compareEnclosures = (
  before: Buffer,
  after: Buffer,
  width: number,
  height: number,
) => {
  const reference = enclosedRegions(before, width, height);
  const traced = enclosedRegions(after, width, height);
  const overlaps = new Map<number, Map<number, number>>();
  for (let i = 0; i < before.length; i += 1) {
    const left = reference.labels[i];
    const right = traced.labels[i];
    if (!reference.areas[left] || !traced.areas[right]) continue;
    const bucket = overlaps.get(left) ?? new Map();
    bucket.set(right, (bucket.get(right) ?? 0) + 1);
    overlaps.set(left, bucket);
  }
  let matched = 0;
  for (const [left, bucket] of overlaps) {
    for (const [right, overlap] of bucket) {
      if (
        overlap / (reference.areas[left] + traced.areas[right] - overlap) <
        0.65
      )
        continue;
      matched += 1;
      break;
    }
  }
  return {
    reference: reference.areas.filter(Boolean).length,
    traced: traced.areas.filter(Boolean).length,
    matched,
  };
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
      enclosures: compareEnclosures(before, after, width, height),
      ...measureCenterlines(document, clean.reference),
    });
  }
  await writeFile(
    new URL(`../results/scan-lighting-${label}.json`, import.meta.url),
    `${JSON.stringify({ label, platform: platform(), cpu: cpus()[0]?.model, node: process.version, reports }, null, 2)}\n`,
  );
  expect(reports).toHaveLength(10);
}, 120_000);
