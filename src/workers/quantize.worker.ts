/// <reference lib="webworker" />

import { createBandQuantizer, type BandQuantizer } from "../core/bandQuantize";
import type { PaletteColor } from "../core/colorTrace";

const workerScope = self as unknown as DedicatedWorkerGlobalScope;
let band: BandQuantizer | null = null;

interface QuantizeMessage {
  type: "init" | "round" | "finish";
  id: number;
  pixels?: ArrayBuffer;
  palette?: PaletteColor[];
}

workerScope.onmessage = (event: MessageEvent<QuantizeMessage>) => {
  const message = event.data;
  try {
    if (message.type === "init") {
      band = createBandQuantizer(
        new Uint8ClampedArray(message.pixels as ArrayBuffer),
      );
      workerScope.postMessage({ type: "ready", id: message.id });
      return;
    }
    if (!band) throw new Error("Band quantizer is not initialized");
    if (message.type === "round") {
      const sums = band.round(
        message.palette as PaletteColor[],
      ) as Float64Array;
      workerScope.postMessage({ type: "sums", id: message.id, sums });
      return;
    }
    const labels = band.finish(message.palette as PaletteColor[]) as Uint8Array;
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
