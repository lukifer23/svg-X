import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { describe, expect, test } from "vitest";
import {
  labelPixels,
  paletteSeeds,
  precomputePixelLabs,
  refinePalette,
  rgbToOklab,
} from "../src/core/colorTrace";
import { benchCases, benchOptions, time, type Rgba } from "./support";

const workerUrl = new URL("./parallel-worker.mjs", import.meta.url);
const threadCounts = [1, 4, 8, 16, 24];

interface WorkerSlot {
  worker: Worker;
  pending: ((value: unknown) => void) | null;
}

const createSlot = (): WorkerSlot => {
  const worker = new Worker(workerUrl);
  const slot: WorkerSlot = { worker, pending: null };
  worker.on("message", (msg: { type: string }) => {
    const resolve = slot.pending;
    slot.pending = null;
    if (resolve) resolve(msg);
  });
  return slot;
};

const request = (slot: WorkerSlot, message: unknown): Promise<Record<string, unknown>> =>
  new Promise((resolve) => {
    slot.pending = resolve as (value: unknown) => void;
    slot.worker.postMessage(message);
  });

const boundsFor = (height: number, n: number) => {
  const bounds: Array<{ start: number; end: number }> = [];
  const per = Math.ceil(height / n);
  for (let index = 0; index < n; index += 1) {
    const start = Math.min(height, index * per);
    const end = Math.min(height, start + per);
    if (start < end) bounds.push({ start, end });
  }
  return bounds;
};

const combineSums = (parts: Float64Array[], length: number): Float64Array => {
  const combined = new Float64Array(length);
  for (const part of parts)
    for (let index = 0; index < combined.length; index += 1)
      combined[index] += part[index];
  return combined;
};

const nextPalette = (
  palette: ReturnType<typeof paletteSeeds>,
  sums: Float64Array,
) =>
  palette.map((color, index) => {
    const n = sums[index * 4 + 3];
    if (n === 0) return color;
    const r = sums[index * 4] / n;
    const g = sums[index * 4 + 1] / n;
    const b = sums[index * 4 + 2] / n;
    return { ...rgbToOklab(r, g, b), r, g, blue: b, count: n };
  });

const parallelQuantize = async (
  slots: WorkerSlot[],
  bands: Array<{ start: number; end: number }>,
  seeds: ReturnType<typeof paletteSeeds>,
): Promise<{ labels: Uint8Array; ms: number }> => {
  const started = performance.now();
  let palette = seeds;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const parts = await Promise.all(
      slots.map((slot) =>
        request(slot, { type: "round", palette }).then(
          (msg) => (msg as { sums: Float64Array }).sums,
        ),
      ),
    );
    const combined = combineSums(parts, palette.length * 4);
    const next = nextPalette(palette, combined);
    const stable = palette.every(
      (color, index) =>
        color.l === next[index].l &&
        color.a === next[index].a &&
        color.b === next[index].b,
    );
    palette = next;
    if (stable) break;
  }
  const labelParts = await Promise.all(
    slots.map((slot) =>
      request(slot, { type: "finish", palette }).then(
        (msg) => (msg as { labels: Uint8Array }).labels,
      ),
    ),
  );
  let total = 0;
  for (const part of labelParts) total += part.length;
  const labels = new Uint8Array(total);
  let offset = 0;
  for (const part of labelParts) {
    labels.set(part, offset);
    offset += part.length;
  }
  return { labels, ms: performance.now() - started };
};

const runCase = async (name: string, rgba: Rgba) => {
  const { pixels, width, height } = rgba;
  const seeds = paletteSeeds(
    pixels,
    Math.max(2, Math.min(8, benchOptions.colorSteps)),
    benchOptions.fillStrategy,
  );
  const labs = precomputePixelLabs(pixels);
  const sequentialPalette = refinePalette(pixels, labs, seeds);
  const sequentialLabels = labelPixels(pixels, labs, sequentialPalette);
  const sequentialMs = time(() => {
    const palette = refinePalette(pixels, labs, seeds);
    labelPixels(pixels, labs, palette);
  });

  const results: Array<{
    threads: number;
    ms: number;
    mismatch: number;
  }> = [];

  for (const n of threadCounts) {
    const bands = boundsFor(height, n);
    const slots = bands.map(() => createSlot());
    const rows = width * 4;
    await Promise.all(
      bands.map((band, index) => {
        const slice = new Uint8Array(
          pixels.subarray(band.start * rows, band.end * rows),
        );
        return request(slots[index], {
          type: "init",
          pixels: slice.buffer,
        });
      }),
    );
    // warmup (workers keep their labs cached)
    await parallelQuantize(slots, bands, seeds);
    let best = Number.POSITIVE_INFINITY;
    let mismatch = 0;
    for (let run = 0; run < 3; run += 1) {
      const { labels, ms } = await parallelQuantize(slots, bands, seeds);
      if (ms < best) best = ms;
      mismatch = 0;
      if (labels.length !== sequentialLabels.length) mismatch = labels.length;
      else
        for (let index = 0; index < labels.length; index += 1)
          if (labels[index] !== sequentialLabels[index]) mismatch += 1;
    }
    results.push({ threads: bands.length, ms: best, mismatch });
    await Promise.all(slots.map((slot) => slot.worker.terminate()));
  }

  return {
    name,
    megapixels: (width * height) / 1e6,
    sequentialMs,
    seeds: seeds.length,
    results,
  };
};

describe("intra-image parallelism prototype", () => {
  test("band-split quantization vs sequential", async () => {
    const cases = await benchCases();
    const label = process.env.BENCH_LABEL || "current";
    const reports = [];
    for (const entry of cases)
      reports.push(await runCase(entry.name, entry.rgba));

    const dir = fileURLToPath(new URL("../results/", import.meta.url));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      `${dir}parallel-${label}.json`,
      `${JSON.stringify(
        {
          label,
          generatedAt: new Date().toISOString(),
          node: process.version,
          cpus: (await import("node:os")).cpus().length,
          reports,
        },
        null,
        2,
      )}\n`,
    );
    console.log(JSON.stringify(reports, null, 2));
    expect(reports.length).toBe(cases.length);
  }, 900_000);
});
