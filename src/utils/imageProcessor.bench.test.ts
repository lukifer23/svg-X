import { describe, expect, test } from "vitest";
import { traceCenterlines } from "../core/centerline";
import { traceColorDocument } from "../core/colorTrace";
import type { WorkerConversionOptions } from "../core/vectorDocument";
import { getOptimizedFilename } from "./imageProcessor";

const options: WorkerConversionOptions = {
  mode: "color",
  threshold: 128,
  turdSize: 2,
  turnPolicy: "minority",
  alphaMax: 1,
  optCurve: true,
  optTolerance: 0.3,
  blackOnWhite: true,
  invert: false,
  foregroundColor: "#000000",
  backgroundColor: "transparent",
  colorSteps: 6,
  fillStrategy: "dominant",
  strokeWidth: 2,
  maxPaths: 2000,
};

const fixture = (size: number): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(size * size * 4);
  const colors = [
    [20, 70, 210],
    [225, 45, 55],
    [245, 195, 30],
    [20, 155, 105],
  ];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const band = (Math.floor(x / 16) + Math.floor(y / 16)) % 4;
      pixels.set([...colors[band], 255], offset);
    }
  }
  return pixels;
};

describe("bounded performance checks", () => {
  test("color-region tracing stays bounded on a representative 128px graphic", () => {
    const pixels = fixture(128);
    const started = performance.now();
    const document = traceColorDocument(pixels, 128, 128, options);
    const elapsed = performance.now() - started;
    expect(document.shapes.length).toBeGreaterThan(1);
    expect(elapsed).toBeLessThan(1_500);
  });

  test("centerline thinning and graph traversal stay bounded", () => {
    const pixels = fixture(128);
    const started = performance.now();
    traceCenterlines(pixels, 128, 128, { ...options, mode: "centerline" });
    expect(performance.now() - started).toBeLessThan(1_500);
  });

  test("filename normalization stays cheap under batch load", () => {
    const started = performance.now();
    for (let index = 0; index < 10_000; index += 1) {
      getOptimizedFilename(`Fixture ${index} :: [raw] .png`);
    }
    expect(performance.now() - started).toBeLessThan(500);
  });
});
