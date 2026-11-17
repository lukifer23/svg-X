import { colorSeeds, type ColorQuantization } from "./colorTrace";
import {
  chooseBandCount,
  parallelQuantize,
  planBands,
} from "./parallelQuantize";
import { getQuantizeWorkerPool, type PooledBand } from "./quantizePool";
import type { WorkerConversionOptions } from "./vectorDocument";

const maxWorkers = (): number =>
  Math.max(1, Math.min(4, navigator.hardwareConcurrency || 4));

/** Parallel quantization needs the Worker API (absent in unit-test runs). */
export const canParallelize = (pixelCount: number): boolean =>
  typeof Worker !== "undefined" &&
  chooseBandCount(pixelCount, maxWorkers()) > 0;

const cancelled = (): DOMException =>
  new DOMException("Conversion cancelled", "AbortError");

/**
 * Splits the RGBA pixels into row bands, quantizes each in a worker, and
 * combines the per-cluster sums in band order. The reduction is exact, so the
 * result is identical to the single-threaded quantizer.
 */
export const quantizeColorInParallel = async (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: WorkerConversionOptions,
  signal?: AbortSignal,
): Promise<ColorQuantization> => {
  const seeds = colorSeeds(pixels, options);
  const ranges = planBands(
    height,
    chooseBandCount(width * height, maxWorkers()),
  );
  const pool = getQuantizeWorkerPool();
  const bands: PooledBand[] = [];
  try {
    const slices: Uint8ClampedArray[] = [];
    for (const range of ranges) {
      if (signal?.aborted) throw cancelled();
      slices.push(
        pixels.subarray(range.start * width * 4, range.end * width * 4),
      );
    }
    bands.push(...(await pool.createBands(slices, signal)));
    if (signal?.aborted) throw cancelled();
    const quantization = await parallelQuantize(
      seeds,
      bands.map((band) => band.quantizer),
    );
    if (signal?.aborted) throw cancelled();
    return quantization;
  } finally {
    for (const band of bands) band.release();
  }
};
