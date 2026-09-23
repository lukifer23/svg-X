// worker_threads baseline for the Bend 2 fixed-palette nearest-label kernel.
// Warm pool; times compute only (worker spawn excluded), mirroring the Bend
// binary's IO.now measurement. Verifies exact equality with labels_double.bin.
import { readFileSync, writeFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

const [rgbaPath, metaPath, outPath, threadsArg, expectedPath] = process.argv.slice(2);
const meta = JSON.parse(readFileSync(metaPath, "utf8"));
const { width, height, palette } = meta;
const pixels = readFileSync(rgbaPath);
const bytesPerRow = width * 4;
const workerUrl = new URL("./worker.mjs", import.meta.url);

const threadCounts = threadsArg
  ? threadsArg.split(",").map(Number)
  : [1, 2, 4, 8, 16, 24];

const med = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const makePool = (n) =>
  Array.from({ length: n }, () => {
    const worker = new Worker(workerUrl);
    worker.setMaxListeners(0);
    return { worker, pending: new Map(), seq: 0 };
  });

const runOn = (slot, band, globalSeq) =>
  new Promise((resolve, reject) => {
    const { worker } = slot;
    const id = ++slot.seq;
    const rows = band.end - band.start;
    const slice = new Uint8Array(
      pixels.subarray(band.start * bytesPerRow, band.end * bytesPerRow),
    );
    const onDone = (msg) => {
      if (msg.id !== id) return;
      worker.off("message", onDone);
      worker.off("error", onError);
      resolve(msg.labels);
    };
    const onError = (error) => {
      worker.off("message", onDone);
      reject(error);
    };
    worker.on("message", onDone);
    worker.on("error", onError);
    worker.postMessage(
      { type: "run", id, pixels: slice.buffer, width, palette },
      [slice.buffer],
    );
    void globalSeq;
  });

const bandsFor = (n) => {
  const bands = [];
  const per = Math.ceil(height / n);
  for (let index = 0; index < n; index += 1) {
    const start = Math.min(height, index * per);
    const end = Math.min(height, start + per);
    if (start < end) bands.push({ start, end });
  }
  return bands;
};

const concatenate = (parts, totalPixels, expectedTotal) => {
  const out = new Uint8Array(expectedTotal);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  if (offset !== totalPixels)
    throw new Error(`label length ${offset} != ${totalPixels}`);
  return out;
};

const expected = expectedPath ? readFileSync(expectedPath) : null;
const totalPixels = width * height;
const results = [];
let lastLabels = null;

for (const n of threadCounts) {
  const pool = makePool(Math.min(n, height));
  const bands = bandsFor(pool.length);
  const runOnce = async () => {
    const parts = await Promise.all(bands.map((band, i) => runOn(pool[i], band, 0)));
    return concatenate(parts, totalPixels, totalPixels);
  };
  await runOnce(); // warmup
  const samples = [];
  for (let i = 0; i < 3; i += 1) {
    const started = performance.now();
    lastLabels = await runOnce();
    samples.push(performance.now() - started);
  }
  results.push({ threads: n, ms: med(samples), samples });
  for (const slot of pool) await slot.worker.terminate();
}

let mismatch = null;
if (expected && lastLabels) {
  mismatch = 0;
  for (let i = 0; i < expected.length; i += 1)
    if (expected[i] !== lastLabels[i]) mismatch += 1;
}
if (outPath && lastLabels) writeFileSync(outPath, lastLabels);

console.log(
  JSON.stringify(
    {
      node: process.version,
      case: meta.name,
      width,
      height,
      palette: palette.length,
      mismatchVsDouble: mismatch,
      results,
    },
    null,
    2,
  ),
);
