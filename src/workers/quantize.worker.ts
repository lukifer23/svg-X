/// <reference lib="webworker" />

import { createBandQuantizer, type BandQuantizer } from "../core/bandQuantize";
import {
  colorSeeds,
  quantizeColor,
  type PaletteColor,
} from "../core/colorTrace";
import type { WorkerConversionOptions } from "../core/vectorDocument";

const workerScope = self as unknown as DedicatedWorkerGlobalScope;
let band: BandQuantizer | null = null;

type QuantizeMessage = { id: number } & (
  | { type: "init"; pixels: ArrayBuffer }
  | { type: "round" | "finish"; palette: PaletteColor[] }
  | { type: "quantize"; pixels: ArrayBuffer; options: WorkerConversionOptions }
);

workerScope.onmessage = (event: MessageEvent<QuantizeMessage>) => {
  const message = event.data;
  try {
    if (message.type === "quantize") {
      band = null;
      const pixels = new Uint8ClampedArray(message.pixels);
      const { labels, palette } = quantizeColor(
        pixels,
        colorSeeds(pixels, message.options),
      );
      workerScope.postMessage(
        { type: "quantized", id: message.id, labels, palette },
        [labels.buffer],
      );
      return;
    }
    if (message.type === "init") {
      band = createBandQuantizer(new Uint8ClampedArray(message.pixels));
      workerScope.postMessage({ type: "ready", id: message.id });
      return;
    }
    if (!band) throw new Error("Band quantizer is not initialized");
    if (message.type === "round") {
      const sums = band.round(message.palette) as Float64Array;
      workerScope.postMessage({ type: "sums", id: message.id, sums });
      return;
    }
    const labels = band.finish(message.palette) as Uint8Array;
    band = null;
    workerScope.postMessage({ type: "labels", id: message.id, labels }, [
      labels.buffer,
    ]);
  } catch (error) {
    workerScope.postMessage({
      type: "error",
      id: message.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
