import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, test } from "vitest";
import {
  labelPixels,
  paletteSeeds,
  precomputePixelLabs,
  refinePalette,
} from "../../../src/core/colorTrace";

const K = 4;
const CHUNK_BYTES = 8192;
const FORK_DEPTH = 6;
const f32 = (value: number): number => Math.fround(value);
const f32Literal = (value: number): string =>
  value < 0 ? `F32.neg(${Math.abs(value)})` : `${value}`;

const synthetic = (size: number): Uint8ClampedArray => {
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

const loadReal = async (
  name: string,
  size: number,
): Promise<{ pixels: Uint8ClampedArray; width: number; height: number }> => {
  const path = fileURLToPath(
    new URL(`../../../tests/fixtures/review/${name}`, import.meta.url),
  );
  const raw = await sharp(readFileSync(path))
    .resize(size, size, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = new Uint8ClampedArray(
    raw.data.buffer,
    raw.data.byteOffset,
    raw.data.byteLength,
  ).slice();
  return { pixels, width: raw.info.width, height: raw.info.height };
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const timeJs = (fn: () => void, iterations = 3): number => {
  const samples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    fn();
    samples.push(performance.now() - started);
  }
  return median(samples);
};

interface Case {
  name: string;
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

const emit = (entry: Case): Record<string, unknown> => {
  const { name, pixels, width, height } = entry;
  const labs = precomputePixelLabs(pixels);
  const seeds = paletteSeeds(pixels, K, "dominant");
  const palette = refinePalette(pixels, labs, seeds);
  const labels = labelPixels(pixels, labs, palette);

  const pl = palette.map((c) => f32(c.l));
  const pa = palette.map((c) => f32(c.a));
  const pb = palette.map((c) => f32(c.b));

  const labelsF32 = new Uint8Array(width * height);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const l = labs.l[pixel];
    const a = labs.a[pixel];
    const b = labs.b[pixel];
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let k = 0; k < palette.length; k += 1) {
      const dl = Math.fround(f32(l) - pl[k]);
      const da = Math.fround(f32(a) - pa[k]);
      const db = Math.fround(f32(b) - pb[k]);
      const distance = Math.fround(
        Math.fround(Math.fround(dl * dl) + Math.fround(da * da)) +
          Math.fround(db * db),
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = k;
      }
    }
    labelsF32[pixel] = best;
  }

  let mismatches = 0;
  for (let index = 0; index < labels.length; index += 1)
    if (labels[index] !== labelsF32[index]) mismatches += 1;

  const params = [
    "import Base",
    "",
    `def K() -> Nat: ${palette.length}n`,
    "",
    ...palette.flatMap((_c, index) => [
      `def PL${index}() -> F32: ${f32Literal(pl[index])}`,
      `def PA${index}() -> F32: ${f32Literal(pa[index])}`,
      `def PB${index}() -> F32: ${f32Literal(pb[index])}`,
    ]),
    "",
    `def W() -> U32: ${width}`,
    `def H() -> U32: ${height}`,
    "",
    `def CH() -> Nat: ${CHUNK_BYTES}n`,
    `def CB() -> Nat: ${FORK_DEPTH}n`,
    "",
  ].join("\n");

  const jsMs = timeJs(() => {
    const nextLabs = precomputePixelLabs(pixels);
    labelPixels(pixels, nextLabs, palette);
  });

  const dir = fileURLToPath(
    new URL(`../fixtures/cases/${name}/`, import.meta.url),
  );
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    `${dir}rgba.bin`,
    Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength),
  );
  writeFileSync(`${dir}labels_double.bin`, Buffer.from(labels));
  writeFileSync(`${dir}labels_f32.bin`, Buffer.from(labelsF32));
  writeFileSync(`${dir}params.bend`, params);
  const meta = {
    name,
    width,
    height,
    palette: palette.map((c) => ({ l: c.l, a: c.a, b: c.b })),
  };
  writeFileSync(`${dir}meta.json`, `${JSON.stringify(meta)}\n`);

  // active case for the kernel (fixed import path)
  const active = fileURLToPath(new URL("../fixtures/active/", import.meta.url));
  mkdirSync(active, { recursive: true });
  writeFileSync(`${active}params.bend`, params);
  writeFileSync(
    `${active}rgba.bin`,
    Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength),
  );
  writeFileSync(`${active}labels_double.bin`, Buffer.from(labels));
  writeFileSync(`${active}labels_f32.bin`, Buffer.from(labelsF32));
  writeFileSync(`${active}meta.json`, `${JSON.stringify(meta)}\n`);

  return {
    name,
    width,
    height,
    megapixels: (width * height) / 1e6,
    k: palette.length,
    doubleVsF32Mismatches: mismatches,
    doubleVsF32Rate: mismatches / labels.length,
    jsKernelMs: jsMs,
    palette: palette.map((c, index) => ({
      l: pl[index],
      a: pa[index],
      b: pb[index],
    })),
  };
};

describe("benchmark cases", () => {
  test("emit cases and record JS kernel timings", async () => {
    const bicycle = await loadReal("color-bicycle.png", 1000);
    const still = await loadReal("realistic-still-life.png", 1254);
    const cases: Case[] = [
      {
        name: "synthetic-128",
        pixels: synthetic(128),
        width: 128,
        height: 128,
      },
      {
        name: "synthetic-1000",
        pixels: synthetic(1000),
        width: 1000,
        height: 1000,
      },
      { name: "bicycle-1000", ...bicycle },
      { name: "stilllife-1254", ...still },
    ];

    const results = cases.map(emit);
    const activeDir = fileURLToPath(
      new URL("../fixtures/active/", import.meta.url),
    );
    writeFileSync(
      `${activeDir}summary.json`,
      `${JSON.stringify(results, null, 2)}\n`,
    );
    console.log(JSON.stringify(results, null, 2));
    expect(results.length).toBeGreaterThan(0);
  }, 600_000);
});
