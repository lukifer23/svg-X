import type { BandQuantizer } from "./bandQuantize";
import {
  paletteFromSums,
  type ColorQuantization,
  type PaletteColor,
} from "./colorTrace";

/**
 * Drives the same four refinement iterations as `refinePalette`, but the
 * per-candidate sums come from independent bands and are combined in band
 * order. Channel sums and counts are exact integers, so the result is
 * bit-identical to the single-threaded reduction.
 */
export const parallelQuantize = async (
  seeds: PaletteColor[],
  bands: BandQuantizer[],
): Promise<ColorQuantization> => {
  let palette = seeds;
  const k = seeds.length;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const parts = await Promise.all(bands.map((band) => band.round(palette)));
    const sums = new Float64Array(k * 4);
    for (const part of parts)
      for (let index = 0; index < sums.length; index += 1)
        sums[index] += part[index];
    const next = paletteFromSums(palette, sums);
    const stable = palette.every(
      (color, index) =>
        color.l === next[index].l &&
        color.a === next[index].a &&
        color.b === next[index].b,
    );
    palette = next;
    if (stable) break;
  }

  const parts = await Promise.all(bands.map((band) => band.finish(palette)));
  let total = 0;
  for (const part of parts) total += part.length;
  const labels = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    labels.set(part, offset);
    offset += part.length;
  }
  return { palette, labels };
};

export interface BandRange {
  start: number;
  end: number;
}

export const planBands = (height: number, count: number): BandRange[] => {
  const bands: BandRange[] = [];
  const per = Math.ceil(height / count);
  for (let index = 0; index < count; index += 1) {
    const start = Math.min(height, index * per);
    const end = Math.min(height, start + per);
    if (start < end) bands.push({ start, end });
  }
  return bands;
};

/** Below this many pixels, worker coordination costs more than it saves. */
export const MIN_PARALLEL_PIXELS = 250_000;

/**
 * Number of bands to use for a given image size, or 0 to stay single-threaded.
 * Grows with the image, capped by the available worker count.
 */
export const chooseBandCount = (
  pixelCount: number,
  maxWorkers: number,
): number => {
  if (pixelCount < MIN_PARALLEL_PIXELS) return 0;
  const bySize = Math.max(2, Math.round(pixelCount / 300_000));
  return Math.max(1, Math.min(Math.min(maxWorkers, 16), bySize));
};
