import { createReadStream } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import sharp from "sharp";
import { rasterSha256, sha256 } from "./training-dataset-hashes.mjs";

const [dataset, ...extra] = process.argv.slice(2);
if (!dataset || extra.length)
  throw new Error("Usage: npm run dataset:audit -- dataset-directory");

const root = await realpath(dataset);
const expected = new Set(["train", "validation", "test"]);
const sizes = { train: 0, validation: 0, test: 0 };
const targets = new Map();
const groups = new Map();
const inputs = new Set();
let rows = 0;
let legacyRows = 0;
const digest = /^[a-f0-9]{64}$/;
const asset = async (relative, directory, extension) => {
  if (
    typeof relative !== "string" ||
    !relative.startsWith(`${directory}/`) ||
    relative !== `${directory}/${path.basename(relative)}` ||
    !relative.endsWith(extension)
  )
    throw new Error(`Invalid ${directory} path on row ${rows}`);
  const file = path.join(root, relative);
  const info = await lstat(file);
  if (!info.isFile() || (await realpath(file)) !== file)
    throw new Error(`Expected a regular dataset file: ${relative}`);
  return { file, size: info.size };
};

const checkRaster = async (file, width, height, expectedHash) => {
  const { data, info } = await sharp(file, {
    limitInputPixels: 2048 * 2048,
    failOn: "warning",
  })
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== width || info.height !== height || info.channels !== 3)
    throw new Error(`Raster dimensions or RGB channels do not match: ${file}`);
  if (expectedHash && rasterSha256(data, width, height) !== expectedHash)
    throw new Error(`Raster pixels do not match manifest: ${file}`);
};
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
const inputSplits = new Map();
const records = createInterface({
  input: createReadStream(path.join(root, "manifest.jsonl")),
  crlfDelay: Infinity,
});
for await (const entry of records) {
  rows += 1;
  const {
    schemaVersion,
    split,
    group,
    source,
    sourceSha256,
    targetPixelSha256,
    inputPixelSha256,
    target,
    input,
    reference,
    width,
    height,
  } = JSON.parse(entry);
  if (schemaVersion === 1) legacyRows += 1;
  else if (schemaVersion !== 2 || !digest.test(inputPixelSha256 ?? ""))
    throw new Error(
      `Unsupported manifest version or missing input hash on row ${rows}`,
    );
  if (!expected.has(split)) throw new Error(`Invalid split on row ${rows}`);
  if (
    typeof source !== "string" ||
    !source ||
    !digest.test(sourceSha256 ?? "") ||
    !digest.test(targetPixelSha256 ?? "") ||
    ![width, height].every(
      (value) => Number.isInteger(value) && value >= 1 && value <= 2048,
    )
  )
    throw new Error(`Invalid source, target hash or dimensions on row ${rows}`);
  requireSingleSplit(groups, group, split, "group");
  requireSingleSplit(sourceSplits, sourceSha256, split, "source");
  requireSingleSplit(pixelSplits, targetPixelSha256, split, "target pixels");
  if (inputs.has(input)) throw new Error(`Repeated input path: ${input}`);
  inputs.add(input);
  const { file: inputFile } = await asset(input, "input", ".png");
  await checkRaster(inputFile, width, height, inputPixelSha256);
  if (schemaVersion === 2)
    requireSingleSplit(inputSplits, inputPixelSha256, split, "input pixels");
  const file = path.join(root, "target", `${sourceSha256}.png`);
  const existing = targets.get(file);
  if (
    target !== `target/${sourceSha256}.png` ||
    reference !== `reference/${sourceSha256}.svg`
  )
    throw new Error(
      `Target and reference must match the source digest on row ${rows}`,
    );
  if (
    existing &&
    (existing.split !== split ||
      existing.source !== source ||
      existing.width !== width ||
      existing.height !== height ||
      existing.targetPixelSha256 !== targetPixelSha256)
  )
    throw new Error(`Inconsistent target records: ${target}`);
  if (existing) continue;
  const referenceFile = await asset(reference, "reference", ".svg");
  if (
    referenceFile.size > 2 * 1024 * 1024 ||
    sha256(await readFile(referenceFile.file)) !== sourceSha256
  )
    throw new Error(`Reference does not match manifest: ${reference}`);
  await asset(target, "target", ".png");
  await checkRaster(file, width, height, targetPixelSha256);
  targets.set(file, { split, source, width, height, targetPixelSha256 });
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
  if (!area) {
    // Area averaging can erase subpixel strokes. Project dark source pixels
    // into the same letterboxed grid when the ordinary silhouette is empty.
    const {
      data,
      info: { width, height },
    } = await sharp(file, { limitInputPixels: 2048 * 2048 })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const scale = side / Math.max(width, height);
    const left = (side - width * scale) / 2;
    const top = (side - height * scale) / 2;
    for (let y = 0; y < height; y += 1) {
      const row = Math.floor(top + (y + 0.5) * scale);
      for (let x = 0; x < width; x += 1) {
        if (data[y * width + x] >= 192) continue;
        const bit = 1 << Math.floor(left + (x + 0.5) * scale);
        if (!(lines[row] & bit)) area += 1;
        lines[row] |= bit;
      }
    }
    if (!area)
      throw new Error(`No foreground survived the audit threshold: ${file}`);
  }
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
    legacyRows,
    uniqueTargets: samples.length,
    bySplit: sizes,
    compared,
    flagged,
  }),
);
if (flagged) process.exitCode = 1;
