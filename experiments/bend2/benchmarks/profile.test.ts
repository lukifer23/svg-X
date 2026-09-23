import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, test } from "vitest";
import {
  labelPixels,
  mergeComponentsToBudget,
  paletteSeeds,
  precomputePixelLabs,
  refinePalette,
  traceBoundaries,
  traceColorDocument,
  type PaletteColor,
} from "../../../src/core/colorTrace";
import type { WorkerConversionOptions } from "../../../src/core/vectorDocument";

const options: WorkerConversionOptions = {
  mode: "color",
  threshold: 128,
  turdSize: 2,
  turnPolicy: "minority",
  alphaMax: 1,
  optCurve: false,
  optTolerance: 0.2,
  blackOnWhite: true,
  invert: false,
  foregroundColor: "#000000",
  backgroundColor: "transparent",
  colorSteps: 8,
  fillStrategy: "dominant",
  strokeWidth: 2,
  maxPaths: 2000,
};

interface Rgba {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

const synthetic = (size: number): Rgba => {
  const pixels = new Uint8ClampedArray(size * size * 4);
  const colors = [
    [20, 70, 210],
    [225, 45, 55],
    [245, 195, 30],
    [20, 155, 105],
    [90, 90, 90],
    [250, 250, 250],
    [10, 10, 10],
    [130, 60, 170],
  ];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const band = (Math.floor(x / 24) + Math.floor(y / 24)) % colors.length;
      pixels.set([...colors[band], 255], offset);
    }
  }
  return { pixels, width: size, height: size };
};

const loadPng = async (name: string, size: number): Promise<Rgba> => {
  const path = fileURLToPath(
    new URL(`../../../tests/fixtures/review/${name}`, import.meta.url),
  );
  const raw = await sharp(readFileSync(path))
    .resize(size, size, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    pixels: new Uint8ClampedArray(
      raw.data.buffer,
      raw.data.byteOffset,
      raw.data.byteLength,
    ).slice(),
    width: raw.info.width,
    height: raw.info.height,
  };
};

const median = (samples: number[]): number => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const time = (fn: () => void, iterations = 3): number => {
  const samples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    fn();
    samples.push(performance.now() - started);
  }
  return median(samples);
};

interface StageReport {
  name: string;
  mp: number;
  seeds: number;
  labs: number;
  refine: number;
  label: number;
  merge: number;
  boundaries: number;
  total: number;
  paths: number;
  components: number;
}

const profile = (rgba: Rgba): StageReport => {
  const { pixels, width, height } = rgba;
  const seeds: PaletteColor[] = paletteSeeds(
    pixels,
    Math.max(2, Math.min(8, options.colorSteps)),
    options.fillStrategy,
  );
  const labs = precomputePixelLabs(pixels);
  const palette = refinePalette(pixels, labs, seeds);
  const labels = labelPixels(pixels, labs, palette);

  const seedsMs = time(() =>
    paletteSeeds(
      pixels,
      Math.max(2, Math.min(8, options.colorSteps)),
      options.fillStrategy,
    ),
  );
  const labsMs = time(() => precomputePixelLabs(pixels));
  const refineMs = time(() => refinePalette(pixels, labs, seeds));
  const labelMs = time(() => labelPixels(pixels, labs, palette));
  const mergeMs = time(() =>
    mergeComponentsToBudget(labels, width, height, palette, options.maxPaths),
  );
  const boundaryMs = time(() => {
    for (let index = 0; index < palette.length; index += 1)
      traceBoundaries(labels, width, height, index);
  });

  const merged = mergeComponentsToBudget(
    labels,
    width,
    height,
    palette,
    options.maxPaths,
  );
  let boundaryCount = 0;
  for (let index = 0; index < palette.length; index += 1)
    boundaryCount += traceBoundaries(
      merged.labels,
      width,
      height,
      index,
    ).length;

  const document = traceColorDocument(pixels, width, height, options);
  const totalMs = time(
    () => traceColorDocument(pixels, width, height, options),
    2,
  );

  return {
    name: "",
    mp: (width * height) / 1e6,
    seeds: seedsMs,
    labs: labsMs,
    refine: refineMs,
    label: labelMs,
    merge: mergeMs,
    boundaries: boundaryMs,
    total: totalMs,
    paths: document.diagnostics?.outputPaths ?? 0,
    components: merged.initial,
  };
};

const table = (reports: StageReport[]): string[] => {
  const lines = [
    "case            MP   seeds   labs  refine   label   merge  bounds   total   paths  comps",
  ];
  for (const report of reports) {
    const quant = report.labs + report.refine + report.label;
    const share = ((quant / report.total) * 100).toFixed(1);
    lines.push(
      `${report.name.padEnd(15)} ${report.mp.toFixed(2)}  ` +
        `${report.seeds.toFixed(0).padStart(5)}  ${report.labs.toFixed(0).padStart(4)}  ` +
        `${report.refine.toFixed(0).padStart(6)}  ${report.label.toFixed(0).padStart(5)}  ` +
        `${report.merge.toFixed(0).padStart(5)}  ${report.boundaries.toFixed(0).padStart(6)}  ` +
        `${report.total.toFixed(0).padStart(5)}  ${String(report.paths).padStart(5)}  ` +
        `${String(report.components).padStart(5)}   quant=${share}%`,
    );
  }
  return lines;
};

describe("phase 3 baseline profile", () => {
  test("color pipeline stage shares", async () => {
    const cases: Array<{ name: string; rgba: Rgba }> = [
      { name: "synthetic-1MP", rgba: synthetic(1000) },
      { name: "bicycle-1000", rgba: await loadPng("color-bicycle.png", 1000) },
      {
        name: "stilllife-1254",
        rgba: await loadPng("realistic-still-life.png", 1254),
      },
      {
        name: "mechanism-1254",
        rgba: await loadPng("centerline-mechanism.png", 1254),
      },
    ];

    const reports: StageReport[] = [];
    for (const entry of cases) {
      const report = profile(entry.rgba);
      report.name = entry.name;
      reports.push(report);
      console.log(
        `[profile] ${entry.name} ${entry.rgba.width}x${entry.rgba.height}`,
      );
    }
    const lines = table(reports);
    console.log(lines.join("\n"));
    const resultsDir = fileURLToPath(
      new URL("../results/", import.meta.url),
    );
    mkdirSync(resultsDir, { recursive: true });
    const body = {
      generatedAt: new Date().toISOString(),
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      options,
      reports,
    };
    writeFileSync(
      `${resultsDir}phase3-profile.json`,
      `${JSON.stringify(body, null, 2)}\n`,
    );
    writeFileSync(`${resultsDir}phase3-profile.txt`, `${lines.join("\n")}\n`);
    expect(reports.length).toBe(cases.length);
  }, 600_000);
});
