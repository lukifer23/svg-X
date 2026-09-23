import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { WorkerConversionOptions } from "../src/core/vectorDocument";

export interface Rgba {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

export const benchOptions: WorkerConversionOptions = {
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

export const synthetic = (size: number): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const band = (Math.floor(x / 16) + Math.floor(y / 16)) % 4;
      const base = [
        [20, 70, 210],
        [225, 45, 55],
        [245, 195, 30],
        [20, 155, 105],
      ][band];
      const gradient = Math.round((x / size) * 40);
      pixels[offset] = Math.min(255, base[0] + gradient);
      pixels[offset + 1] = Math.min(255, base[1] + gradient);
      pixels[offset + 2] = Math.min(255, base[2] + gradient);
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
};

export const loadReal = async (name: string): Promise<Rgba> => {
  const path = fileURLToPath(
    new URL(`../tests/fixtures/review/${name}`, import.meta.url),
  );
  const raw = await sharp(readFileSync(path))
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

export const benchCases = async (): Promise<
  Array<{ name: string; rgba: Rgba }>
> => [
  {
    name: "synthetic-1000",
    rgba: { pixels: synthetic(1000), width: 1000, height: 1000 },
  },
  { name: "color-bicycle", rgba: await loadReal("color-bicycle.png") },
  {
    name: "realistic-still-life",
    rgba: await loadReal("realistic-still-life.png"),
  },
  {
    name: "centerline-mechanism",
    rgba: await loadReal("centerline-mechanism.png"),
  },
];

// Minimum of a warm run is the most stable estimator for CPU-bound kernels:
// it discards GC pauses and scheduler noise that make the median jump.
export const time = (fn: () => void, iterations = 5): number => {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    fn();
    const elapsed = performance.now() - started;
    if (elapsed < best) best = elapsed;
  }
  return best;
};
