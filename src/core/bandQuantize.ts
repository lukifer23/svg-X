import {
  accumulatePaletteSums,
  labelPixels,
  precomputePixelLabs,
  type PaletteColor,
  type PixelLabs,
} from "./colorTrace";

export type Awaitable<T> = T | Promise<T>;

/**
 * One contiguous band of a color conversion. `round` returns the band's
 * per-candidate [r, g, b, count] partial sums for a palette; `finish` returns
 * the band's labels for the final palette. The same implementation backs the
 * in-process quantizer and the Web Worker.
 */
export interface BandQuantizer {
  round(palette: PaletteColor[]): Awaitable<Float64Array>;
  finish(palette: PaletteColor[]): Awaitable<Uint8Array>;
}

export const createBandQuantizer = (
  pixels: Uint8ClampedArray,
): BandQuantizer => {
  const labs: PixelLabs = precomputePixelLabs(pixels);
  let sums = new Float64Array(0);
  return {
    round(palette: PaletteColor[]): Float64Array {
      const needed = palette.length * 4;
      if (sums.length !== needed) sums = new Float64Array(needed);
      else sums.fill(0);
      accumulatePaletteSums(pixels, labs, palette, sums);
      return sums;
    },
    finish(palette: PaletteColor[]): Uint8Array {
      return labelPixels(pixels, labs, palette);
    },
  };
};
