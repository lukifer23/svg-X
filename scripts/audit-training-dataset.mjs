import { createReadStream } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import sharp from "sharp";

const [dataset, ...extra] = process.argv.slice(2);
if (!dataset || extra.length)
  throw new Error("Usage: npm run dataset:audit -- dataset-directory");

const root = path.resolve(dataset);
const expected = new Set(["train", "validation", "test"]);
const sizes = { train: 0, validation: 0, test: 0 };
const targets = new Map();
const groups = new Map();
let rows = 0;
const requireSingleSplit = (entries, key, split, label) => {
  if (typeof key !== "string" || !key)
    throw new Error(`Missing ${label} on row ${rows}`);
  const previous = entries.get(key);
  if (previous && previous !== split)
    throw new Error(
      `${label} appears in both ${previous} and ${split}: ${key}`,
    );
  entries.set(key, split);
};
const sourceSplits = new Map();
const pixelSplits = new Map();
const records = createInterface({
  input: createReadStream(path.join(root, "manifest.jsonl")),
  crlfDelay: Infinity,
});
for await (const entry of records) {
  rows += 1;
  const { split, group, source, sourceSha256, targetPixelSha256, target } =
    JSON.parse(entry);
  if (!expected.has(split)) throw new Error(`Invalid split on row ${rows}`);
  if (typeof source !== "string" || !source || typeof target !== "string")
    throw new Error(`Missing source or target path on row ${rows}`);
  requireSingleSplit(groups, group, split, "group");
  requireSingleSplit(sourceSplits, sourceSha256, split, "source");
  requireSingleSplit(pixelSplits, targetPixelSha256, split, "target pixels");
  const file = path.resolve(root, target);
  if (path.dirname(file) !== path.join(root, "target"))
    throw new Error(`Invalid target path on row ${rows}`);
  const existing = targets.get(file);
  if (existing && (existing.split !== split || existing.source !== source))
    throw new Error(`Inconsistent target records: ${target}`);
  if (existing) continue;
  targets.set(file, { split, source });
  sizes[split] += 1;
}
if (!rows || [...expected].some((split) => sizes[split] === 0))
  throw new Error(
    "Dataset audit requires targets in train, validation, and test",
  );

const side = 32;
const getMask = async (file) => {
  const alpha = await sharp(file, { limitInputPixels: 16_000_000 })
    .flatten({ background: "#ffffff" })
    .resize(side, side, { fit: "contain", background: "#ffffff" })
    .greyscale()
    .raw()
    .toBuffer();
  if (alpha.length !== side * side)
    throw new Error(`Unexpected grayscale sample dimensions: ${file}`);
  const lines = new Uint32Array(side);
  let area = 0;
  for (let y = 0; y < side; y += 1)
    for (let x = 0; x < side; x += 1)
      if (alpha[y * side + x] < 192) {
        lines[y] |= 1 << x;
        area += 1;
      }
  if (!area)
    throw new Error(`No foreground survived the audit threshold: ${file}`);
  return { lines, area };
};
const bitCount = (value) => {
  value -= (value >>> 1) & 0x55555555;
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
  return Math.imul((value + (value >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
};

const samples = [];
for (const [file, item] of targets)
  samples.push({ ...item, ...(await getMask(file)) });
let compared = 0;
let flagged = 0;
const threshold = 0.82;
for (const [index, left] of samples.entries())
  for (let i = index + 1; i < samples.length; i += 1) {
    const right = samples[i];
    if (left.split === right.split) continue;
    compared += 1;
    if (
      Math.min(left.area, right.area) <
      threshold * Math.max(left.area, right.area)
    )
      continue;
    let intersection = 0;
    for (let y = 0; y < side; y += 1)
      intersection += bitCount(left.lines[y] & right.lines[y]);
    const union = left.area + right.area - intersection;
    const iou = union ? intersection / union : 1;
    if (iou < threshold) continue;
    flagged += 1;
    console.error(
      `Review cross-split silhouettes ${left.source} (${left.split}) and ${right.source} (${right.split}), IoU ${iou.toFixed(3)}`,
    );
  }
console.log(
  JSON.stringify({
    rows,
    uniqueTargets: samples.length,
    bySplit: sizes,
    compared,
    flagged,
  }),
);
if (flagged) process.exitCode = 1;
