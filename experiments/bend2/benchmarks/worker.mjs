// Worker for the worker_threads baseline: runs the exact SVG-X
// precomputePixelLabs + labelPixels on one horizontal band of the image.
import { parentPort } from "node:worker_threads";
import { precomputePixelLabs, labelPixels } from "../.build/colorTrace.js";

parentPort.on("message", (msg) => {
  const { type, id, pixels, width, palette } = msg;
  if (type !== "run") return;
  const rgba = new Uint8ClampedArray(pixels);
  const labs = precomputePixelLabs(rgba);
  const labels = labelPixels(rgba, labs, palette);
  parentPort.postMessage({ type: "done", id, labels }, [labels.buffer]);
});
