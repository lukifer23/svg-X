import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  labelPixels,
  paletteSeeds,
  precomputePixelLabs,
  refinePalette,
} from "../../../src/core/colorTrace";

const K = 4;

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

const f32 = (value: number): number => Math.fround(value);

// Bend 2 rejects a negative F32 literal; emit F32.neg for those.
const f32Literal = (value: number): string =>
  value < 0 ? `F32.neg(${Math.abs(value)})` : `${value}`;

describe("phase 4 fixtures", () => {
  test("emit rgba.bin, params.bend and both oracles", () => {
    const size = 128;
    const pixels = synthetic(size);
    const labs = precomputePixelLabs(pixels);
    const seeds = paletteSeeds(pixels, K, "dominant");
    const palette = refinePalette(pixels, labs, seeds);
    const labels = labelPixels(pixels, labs, palette);

    const pl = palette.map((c) => f32(c.l));
    const pa = palette.map((c) => f32(c.a));
    const pb = palette.map((c) => f32(c.b));

    const params = [
      "import Base",
      "",
      `def K() -> Nat: ${palette.length}n`,
      "",
      ...palette.flatMap((_color, index) => [
        `def PL${index}() -> F32: ${f32Literal(pl[index])}`,
        `def PA${index}() -> F32: ${f32Literal(pa[index])}`,
        `def PB${index}() -> F32: ${f32Literal(pb[index])}`,
      ]),
      "",
      `def W() -> U32: ${size}`,
      `def H() -> U32: ${size}`,
      "",
    ].join("\n");

    // F32 oracle: nearest palette using fround-emulated arithmetic.
    const labelsF32 = new Uint8Array(size * size);
    for (let pixel = 0; pixel < size * size; pixel += 1) {
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

    const dir = fileURLToPath(new URL("../fixtures/phase4/", import.meta.url));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      `${dir}rgba.bin`,
      Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength),
    );
    writeFileSync(`${dir}labels_double.bin`, Buffer.from(labels));
    writeFileSync(`${dir}labels_f32.bin`, Buffer.from(labelsF32));
    writeFileSync(`${dir}params.bend`, params);

    const summary = {
      size,
      k: palette.length,
      doubleVsF32Mismatches: mismatches,
      doubleVsF32Rate: mismatches / labels.length,
      palette: palette.map((c, index) => ({
        l: pl[index],
        a: pa[index],
        b: pb[index],
      })),
    };
    writeFileSync(`${dir}summary.json`, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(
      `[phase4] ${size}x${size} k=${palette.length} ` +
        `double-vs-f32 mismatches=${mismatches} (${(
          (mismatches / labels.length) *
          100
        ).toFixed(4)}%)`,
    );
    expect(palette.length).toBe(K);
    expect(mismatches / labels.length).toBeLessThan(0.01);
  });
});
