import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { createBandQuantizer } from "./bandQuantize";
import { assembleColorDocument, colorSeeds, quantizeColor } from "./colorTrace";
import {
  chooseBandCount,
  parallelQuantize,
  planBands,
} from "./parallelQuantize";
import { serializeVectorDocument } from "./serialize";
import type { WorkerConversionOptions } from "./vectorDocument";

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
  colorSteps: 6,
  fillStrategy: "dominant",
  strokeWidth: 2,
  maxPaths: 2000,
};

// Deliberately odd dimensions and some transparent pixels so band boundaries
// and the alpha-skip path are exercised.
const makePixels = (width: number, height: number): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const band = (Math.floor(x / 5) + Math.floor(y / 7)) % 4;
      pixels[offset] = (band * 63 + x * 3) % 256;
      pixels[offset + 1] = (band * 40 + y * 5) % 256;
      pixels[offset + 2] = (200 - band * 30 + x + y) % 256;
      pixels[offset + 3] = (x + y) % 17 === 0 ? 0 : 255;
    }
  }
  return pixels;
};

describe("parallel quantization", () => {
  test("banded reduction is bit-identical to single-threaded", async () => {
    const width = 37;
    const height = 53;
    const pixels = makePixels(width, height);
    const seeds = colorSeeds(pixels, options);
    const sequential = quantizeColor(pixels, seeds);
    const sequentialDocument = assembleColorDocument(
      sequential.labels,
      sequential.palette,
      width,
      height,
      options,
    );
    const sequentialHash = createHash("sha256")
      .update(serializeVectorDocument(sequentialDocument))
      .digest("hex");

    for (const count of [2, 3, 5, 8]) {
      const ranges = planBands(height, count);
      const bands = ranges.map((range) =>
        createBandQuantizer(
          pixels.subarray(range.start * width * 4, range.end * width * 4),
        ),
      );
      const result = await parallelQuantize(seeds, bands);

      expect(result.labels.length, `bands=${count}`).toBe(width * height);
      for (let index = 0; index < result.labels.length; index += 1)
        if (result.labels[index] !== sequential.labels[index])
          throw new Error(`label mismatch at ${index} for bands=${count}`);
      result.palette.forEach((color, index) => {
        expect(color.l).toBe(sequential.palette[index].l);
        expect(color.a).toBe(sequential.palette[index].a);
        expect(color.b).toBe(sequential.palette[index].b);
        expect(color.count).toBe(sequential.palette[index].count);
      });

      const document = assembleColorDocument(
        result.labels,
        result.palette,
        width,
        height,
        options,
      );
      const hash = createHash("sha256")
        .update(serializeVectorDocument(document))
        .digest("hex");
      expect(hash, `bands=${count}`).toBe(sequentialHash);
    }
  });

  test("band planning stays single-threaded for small images", () => {
    expect(chooseBandCount(10_000, 16)).toBe(0);
    expect(chooseBandCount(250_000, 16)).toBeGreaterThanOrEqual(2);
    expect(chooseBandCount(250_000, 1)).toBe(1);
    expect(chooseBandCount(50_000_000, 16)).toBe(16);
    expect(chooseBandCount(50_000_000, 4)).toBe(4);

    const bands = planBands(10, 16);
    expect(bands[0].start).toBe(0);
    expect(bands[bands.length - 1].end).toBe(10);
    for (let index = 1; index < bands.length; index += 1)
      expect(bands[index].start).toBe(bands[index - 1].end);
  });
});
