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
export const canParallelize = (
  pixelCount: number,
  workerLimit = maxWorkers(),
): boolean =>
  typeof Worker !== "undefined" && chooseBandCount(pixelCount, workerLimit) > 0;

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
  workerLimit = maxWorkers(),
): Promise<ColorQuantization> => {
  const count = chooseBandCount(width * height, workerLimit);
  const pool = getQuantizeWorkerPool();
  // A single worker can finish the complete reduction without sending
  // intermediate palettes and sums back through the renderer.
  if (count === 1) return pool.quantizeImage(pixels, options, signal);
  const seeds = colorSeeds(pixels, options);
  const ranges = planBands(height, count);
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
