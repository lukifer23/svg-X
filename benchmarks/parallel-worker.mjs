// Worker for the intra-image parallelism prototype: owns one horizontal band,
// keeps its OKLab labs cached, and answers palette rounds with per-cluster
// partial sums. Because channel sums and counts are exact integers, combining
// band partials in band order reproduces the sequential float64 reduction
// bit-for-bit.
import { parentPort } from "node:worker_threads";
import { labelPixels, precomputePixelLabs } from "./.build/colorTrace.js";

let rgba = null;
let labs = null;
let count = 0;

parentPort.on("message", (msg) => {
  switch (msg.type) {
    case "init": {
      rgba = new Uint8ClampedArray(msg.pixels);
      labs = precomputePixelLabs(rgba);
      count = rgba.length >> 2;
      parentPort.postMessage({ type: "ready", id: msg.id });
      break;
    }
    case "round": {
      const palette = msg.palette;
      const k = palette.length;
      const sums = new Float64Array(k * 4);
      for (let pixel = 0; pixel < count; pixel += 1) {
        const index = pixel << 2;
        if (rgba[index + 3] < 8) continue;
        const pl = labs.l[pixel];
        const pa = labs.a[pixel];
        const pb = labs.b[pixel];
        let closest = 0;
        let closestDistance = Number.POSITIVE_INFINITY;
        for (let candidate = 0; candidate < k; candidate += 1) {
          const color = palette[candidate];
          const dl = pl - color.l;
          const da = pa - color.a;
          const db = pb - color.b;
          const distance = dl * dl + da * da + db * db;
          if (distance < closestDistance) {
            closestDistance = distance;
            closest = candidate;
          }
        }
        sums[closest * 4] += rgba[index];
        sums[closest * 4 + 1] += rgba[index + 1];
        sums[closest * 4 + 2] += rgba[index + 2];
        sums[closest * 4 + 3] += 1;
      }
      parentPort.postMessage({ type: "sums", id: msg.id, sums });
      break;
    }
    case "finish": {
      const labels = labelPixels(rgba, labs, msg.palette);
      parentPort.postMessage({ type: "labels", id: msg.id, labels }, [
        labels.buffer,
      ]);
      break;
    }
    default:
      break;
  }
});
