import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  labelPixels,
  mergeComponentsToBudget,
  paletteSeeds,
  precomputePixelLabs,
  refinePalette,
  traceBoundaries,
  traceColorDocument,
} from "../src/core/colorTrace";
import { traceCenterlines } from "../src/core/centerline";
import { traceBlackAndWhite } from "../src/core/bwTrace";
import { serializeVectorDocument } from "../src/core/serialize";
import { benchCases, benchOptions, time, type Rgba } from "./support";

const hashOf = (document: ReturnType<typeof traceColorDocument>): string =>
  createHash("sha256")
    .update(serializeVectorDocument(document))
    .digest("hex");

const profileCase = (name: string, rgba: Rgba) => {
  const { pixels, width, height } = rgba;
  const seeds = paletteSeeds(
    pixels,
    Math.max(2, Math.min(8, benchOptions.colorSteps)),
    benchOptions.fillStrategy,
  );
  const labs = precomputePixelLabs(pixels);
  const palette = refinePalette(pixels, labs, seeds);
  const labels = labelPixels(pixels, labs, palette);
  const merged = mergeComponentsToBudget(
    labels,
    width,
    height,
    palette,
    benchOptions.maxPaths,
  );

  const document = traceColorDocument(pixels, width, height, benchOptions);

  const heapBefore = process.memoryUsage().heapUsed;
  const totalColor = time(() =>
    traceColorDocument(pixels, width, height, benchOptions),
  );
  const heapAfter = process.memoryUsage().heapUsed;

  const stages = {
    paletteSeeds: time(() =>
      paletteSeeds(
        pixels,
        Math.max(2, Math.min(8, benchOptions.colorSteps)),
        benchOptions.fillStrategy,
      ),
    ),
    precomputePixelLabs: time(() => precomputePixelLabs(pixels)),
    refinePalette: time(() => refinePalette(pixels, labs, seeds)),
    labelPixels: time(() => labelPixels(pixels, labs, palette)),
    mergeComponentsToBudget: time(() =>
      mergeComponentsToBudget(
        labels,
        width,
        height,
        palette,
        benchOptions.maxPaths,
      ),
    ),
    traceBoundaries: time(() => {
      for (let index = 0; index < palette.length; index += 1)
        traceBoundaries(merged.labels, width, height, index);
    }),
  };
  const quantization =
    stages.precomputePixelLabs + stages.refinePalette + stages.labelPixels;

  return {
    name,
    width,
    height,
    megapixels: (width * height) / 1e6,
    paletteSize: palette.length,
    components: merged.initial,
    outputPaths: document.diagnostics?.outputPaths ?? 0,
    outputHash: hashOf(document),
    heapDeltaMB: Math.max(0, (heapAfter - heapBefore) / 1024 / 1024),
    stages,
    quantizationMs: quantization,
    quantizationShare: quantization / totalColor,
    totalColorMs: totalColor,
    totalBwMs: time(() =>
      traceBlackAndWhite(pixels, width, height, { ...benchOptions, mode: "bw" }),
    ),
    totalCenterlineMs: time(() =>
      traceCenterlines(pixels, width, height, {
        ...benchOptions,
        mode: "centerline",
      }),
    ),
  };
};

describe("pipeline benchmark", () => {
  test("stage profile for representative inputs", async () => {
    const cases = await benchCases();
    const label = process.env.BENCH_LABEL || "current";
    const reports = cases.map((entry) => profileCase(entry.name, entry.rgba));

    const dir = fileURLToPath(new URL("../results/", import.meta.url));
    mkdirSync(dir, { recursive: true });
    const payload = {
      label,
      generatedAt: new Date().toISOString(),
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      options: benchOptions,
      reports,
    };
    writeFileSync(
      `${dir}pipeline-${label}.json`,
      `${JSON.stringify(payload, null, 2)}\n`,
    );
    console.log(JSON.stringify(reports, null, 2));
    expect(reports.length).toBe(cases.length);
  }, 900_000);
});
