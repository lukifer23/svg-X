import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { traceBlackAndWhite } from "./bwTrace";
import { traceCenterlines } from "./centerline";
import { traceColorDocument } from "./colorTrace";
import { meanDeltaE00 } from "./colorMetrics";
import { serializeVectorDocument } from "./serialize";
import type { WorkerConversionOptions } from "./vectorDocument";

const options = (
  overrides: Partial<WorkerConversionOptions>,
): WorkerConversionOptions => ({
  mode: "color",
  threshold: 128,
  turdSize: 0,
  turnPolicy: "minority",
  alphaMax: 1,
  optCurve: true,
  optTolerance: 0,
  blackOnWhite: true,
  invert: false,
  foregroundColor: "#000000",
  backgroundColor: "transparent",
  colorSteps: 4,
  fillStrategy: "dominant",
  strokeWidth: 1,
  maxPaths: 500,
  ...overrides,
});

const ssim = (left: Uint8Array, right: Uint8Array): number => {
  let leftMean = 0;
  let rightMean = 0;
  for (let index = 0; index < left.length; index += 1) {
    leftMean += left[index];
    rightMean += right[index];
  }
  leftMean /= left.length;
  rightMean /= right.length;
  let leftVariance = 0;
  let rightVariance = 0;
  let covariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    leftVariance += leftDelta ** 2;
    rightVariance += rightDelta ** 2;
    covariance += leftDelta * rightDelta;
  }
  const divisor = Math.max(1, left.length - 1);
  leftVariance /= divisor;
  rightVariance /= divisor;
  covariance /= divisor;
  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;
  return (
    ((2 * leftMean * rightMean + c1) * (2 * covariance + c2)) /
    ((leftMean ** 2 + rightMean ** 2 + c1) *
      (leftVariance + rightVariance + c2))
  );
};

describe("quality acceptance", () => {
  test("flat-color topology rasterizes with SSIM at least 0.95", async () => {
    const width = 64;
    const height = 64;
    const pixels = new Uint8ClampedArray(width * height * 4);
    const palette = [
      [230, 40, 50],
      [20, 90, 220],
      [245, 200, 25],
      [20, 160, 110],
    ];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const color =
          palette[(x >= width / 2 ? 1 : 0) + (y >= height / 2 ? 2 : 0)];
        pixels.set([...color, 255], (y * width + x) * 4);
      }
    }
    const document = traceColorDocument(pixels, width, height, options({}));
    const rendered = await sharp(Buffer.from(serializeVectorDocument(document)))
      .removeAlpha()
      .raw()
      .toBuffer();
    const sourceRgb = new Uint8Array(width * height * 3);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      sourceRgb.set(pixels.subarray(pixel * 4, pixel * 4 + 3), pixel * 3);
    }
    expect(ssim(sourceRgb, rendered)).toBeGreaterThanOrEqual(0.95);
    expect(meanDeltaE00(sourceRgb, rendered)).toBeLessThanOrEqual(2);
  });

  test("centerline stays within 1.5 pixels of a thick vertical line center", () => {
    const width = 11;
    const height = 15;
    const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let y = 2; y <= 12; y += 1) {
      for (let x = 4; x <= 6; x += 1) {
        const offset = (y * width + x) * 4;
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
      }
    }
    const document = traceCenterlines(
      pixels,
      width,
      height,
      options({ mode: "centerline" }),
    );
    const xValues = document.shapes.flatMap((shape) =>
      shape.subpaths.flatMap((path) =>
        path.commands.flatMap((command) =>
          command.type === "M" || command.type === "L" ? [command.x] : [],
        ),
      ),
    );
    const meanDistance =
      xValues.reduce((sum, x) => sum + Math.abs(x - 5.5), 0) / xValues.length;
    expect(meanDistance).toBeLessThanOrEqual(1.5);
  });

  test("B&W Potrace preserves a synthetic filled block within one percent", async () => {
    const width = 40;
    const height = 40;
    const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let y = 10; y < 30; y += 1) {
      for (let x = 10; x < 30; x += 1) {
        const offset = (y * width + x) * 4;
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
      }
    }
    const document = traceBlackAndWhite(
      pixels,
      width,
      height,
      options({ mode: "bw" }),
    );
    const rendered = await sharp(Buffer.from(serializeVectorDocument(document)))
      .flatten({ background: "#ffffff" })
      .greyscale()
      .raw()
      .toBuffer();
    let differences = 0;
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const expectedDark = pixels[pixel * 4] < 128;
      const actualDark = rendered[pixel] < 128;
      if (expectedDark !== actualDark) differences += 1;
    }
    expect(differences / (width * height)).toBeLessThanOrEqual(0.01);
  });
});
