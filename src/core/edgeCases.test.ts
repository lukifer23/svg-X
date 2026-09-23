import { describe, expect, test } from "vitest";
import { traceBlackAndWhite } from "./bwTrace";
import { traceCenterlines } from "./centerline";
import { traceColorDocument } from "./colorTrace";
import { serializeVectorDocument } from "./serialize";
import type { VectorDocument, WorkerConversionOptions } from "./vectorDocument";

const base: WorkerConversionOptions = {
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
  colorSteps: 4,
  fillStrategy: "dominant",
  strokeWidth: 1,
  maxPaths: 500,
};

const rgba = (
  width: number,
  height: number,
  fill: [number, number, number, number],
): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1)
    pixels.set(fill, pixel * 4);
  return pixels;
};

const assertFinite = (document: VectorDocument) => {
  for (const shape of document.shapes)
    for (const subpath of shape.subpaths)
      for (const command of subpath.commands) {
        if (command.type === "Z") continue;
        expect(Number.isFinite(command.x), "x finite").toBe(true);
        expect(Number.isFinite(command.y), "y finite").toBe(true);
        if (command.type === "C") {
          expect(Number.isFinite(command.x1)).toBe(true);
          expect(Number.isFinite(command.y1)).toBe(true);
          expect(Number.isFinite(command.x2)).toBe(true);
          expect(Number.isFinite(command.y2)).toBe(true);
        }
      }
};

const runAllModes = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
) => {
  const color = traceColorDocument(pixels, width, height, {
    ...base,
    mode: "color",
  });
  const bw = traceBlackAndWhite(pixels, width, height, { ...base, mode: "bw" });
  const centerline = traceCenterlines(pixels, width, height, {
    ...base,
    mode: "centerline",
  });
  for (const document of [color, bw, centerline]) {
    expect(document.width).toBe(width);
    expect(document.height).toBe(height);
    expect(serializeVectorDocument(document)).toContain("<svg");
    assertFinite(document);
  }
  return { color, bw, centerline };
};

describe("degenerate input edge cases", () => {
  test("1x1 opaque image", () => {
    runAllModes(rgba(1, 1, [10, 200, 30, 255]), 1, 1);
  });

  test("all-transparent image", () => {
    runAllModes(rgba(8, 8, [0, 0, 0, 0]), 8, 8);
  });

  test("single-color image", () => {
    runAllModes(rgba(12, 12, [120, 40, 200, 255]), 12, 12);
  });

  test("two-color image", () => {
    const width = 16;
    const height = 16;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < width; x += 1)
        pixels.set(
          x < width / 2 ? [10, 10, 240, 255] : [250, 250, 10, 255],
          (y * width + x) * 4,
        );
    const { color } = runAllModes(pixels, width, height);
    expect(color.shapes.length).toBeGreaterThan(0);
  });
});
