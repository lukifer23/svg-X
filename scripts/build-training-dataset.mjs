import { createHash } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { optimize } from "svgo";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const MAX_SVG_BYTES = 2 * 1024 * 1024;
const MAX_RASTER_PIXELS = 16_000_000;
const requiredText = (value) =>
  typeof value === "string" && value.trim() === value && value.length > 0;

const validateSvg = (svg, source) => {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(svg))
    throw new Error(`XML declarations are forbidden in ${source}`);
  if (/<\?xml-stylesheet\b/i.test(svg))
    throw new Error(`External stylesheets are forbidden in ${source}`);
  let root = false;
  optimize(svg, {
    path: source,
    plugins: [
      {
        name: "self-contained-svg",
        fn: () => ({
          element: {
            enter(node) {
              if (node.name === "svg") root = true;
              if (
                [
                  "script",
                  "foreignobject",
                  "image",
                  "feimage",
                  "style",
                ].includes(node.name.toLowerCase())
              )
                throw new Error(
                  `Unsupported SVG element in ${source}: ${node.name}`,
                );
              for (const [name, value] of Object.entries(node.attributes)) {
                const attribute = name.toLowerCase();
                if (
                  attribute.startsWith("on") ||
                  ((attribute === "href" || attribute.endsWith(":href")) &&
                    !/^#[\w.-]+$/.test(value)) ||
                  attribute === "style" ||
                  (/url\s*\(/i.test(value) &&
                    !/^url\(\s*#[\w.-]+\s*\)$/.test(value))
                )
                  throw new Error(
                    `Unsupported SVG reference or style in ${source}: ${name}`,
                  );
              }
            },
          },
        }),
      },
    ],
  });
  if (!root) throw new Error(`Missing SVG root in ${source}`);
};

const randomGenerator = (key) => {
  let state = Number.parseInt(sha256(key).slice(0, 8), 16);
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
};

const degrade = (data, width, height, key) => {
  const random = randomGenerator(key);
  const fade = 0.2 + random() * 0.7;
  const shadow = random() * 0.42;
  const noise = 1 + random() * 5;
  const flip = random() < 0.5;
  const pixels = Buffer.allocUnsafe(data.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const horizontal = x / Math.max(1, width - 1);
      const paper = 255 * (1 - shadow * (flip ? horizontal : 1 - horizontal));
      const grain =
        (random() + random() - 1) * noise - (random() < 0.008 ? 26 : 0);
      const offset = (y * width + x) * 3;
      for (let channel = 0; channel < 3; channel += 1)
        pixels[offset + channel] = Math.round(
          Math.max(
            0,
            Math.min(
              255,
              ((255 - (255 - data[offset + channel]) * fade) * paper) / 255 +
                grain,
            ),
          ),
        );
    }
  }
  return { pixels, fade, shadow, noise, flip };
};

const args = process.argv.slice(2);
if (args.length !== 2)
  throw new Error(
    "Usage: npm run dataset:build -- input-manifest.json new-output-directory",
  );
const [manifestPath, output] = args.map((arg) => path.resolve(arg));
const config = JSON.parse(await readFile(manifestPath, "utf8"));
const { seed = "svgx-v1", variants = 3, maxDimension = 768, items } = config;
if (
  !requiredText(seed) ||
  !Number.isInteger(variants) ||
  variants < 1 ||
  variants > 32 ||
  !Number.isInteger(maxDimension) ||
  maxDimension < 16 ||
  maxDimension > 2048 ||
  !Array.isArray(items) ||
  items.length === 0 ||
  items.length > 10_000
)
  throw new Error(
    "Invalid manifest limits (1–10000 SVGs, 1–32 variants, 16–2048 px, nonempty seed)",
  );

const manifestDirectory = path.dirname(manifestPath);
const seen = new Set();
const rasterGroups = new Map();
await mkdir(output);
for (const directory of ["input", "target", "reference"])
  await mkdir(path.join(output, directory));
const partial = path.join(output, ".manifest.jsonl.partial");
const index = await open(partial, "wx");
let written = 0;
try {
  for (const item of items) {
    if (
      !item ||
      !requiredText(item.svg) ||
      !requiredText(item.group) ||
      !requiredText(item.license) ||
      path.isAbsolute(item.svg) ||
      path.extname(item.svg).toLowerCase() !== ".svg"
    )
      throw new Error(
        "Each item needs a relative SVG path, a source family group, and an explicit license",
      );
    const source = path.resolve(manifestDirectory, item.svg);
    const info = await stat(source);
    if (!info.isFile() || info.size > MAX_SVG_BYTES)
      throw new Error(`SVG source exceeds file limits: ${item.svg}`);
    const svg = await readFile(source);
    const digest = sha256(svg);
    if (seen.has(digest)) throw new Error(`Duplicate SVG content: ${item.svg}`);
    seen.add(digest);
    validateSvg(svg.toString("utf8"), item.svg);
    const splitValue =
      Number.parseInt(sha256(`svgx-split-v1\0${item.group}`).slice(0, 8), 16) /
      2 ** 32;
    const split =
      splitValue < 0.8 ? "train" : splitValue < 0.9 ? "validation" : "test";
    const reference = `reference/${digest}.svg`;
    const target = `target/${digest}.png`;
    const {
      data,
      info: { width, height },
    } = await sharp(svg, {
      limitInputPixels: MAX_RASTER_PIXELS,
      failOn: "error",
    })
      .resize(maxDimension, maxDimension, { fit: "inside" })
      .flatten({ background: "#ffffff" })
      .toColourspace("srgb")
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const targetPixelSha256 = sha256(
      Buffer.concat([Buffer.from(`${width}x${height}\0`), data]),
    );
    const previousGroup = rasterGroups.get(targetPixelSha256);
    if (previousGroup && previousGroup !== item.group)
      throw new Error(
        `Identical clean raster assigned to multiple groups: ${item.svg}`,
      );
    rasterGroups.set(targetPixelSha256, item.group);
    const encode = (pixels) =>
      sharp(pixels, { raw: { width, height, channels: 3 } }).png();
    await writeFile(path.join(output, reference), svg, { flag: "wx" });
    await encode(data).toFile(path.join(output, target));
    for (let variant = 0; variant < variants; variant += 1) {
      const id = `${digest}-${variant}`;
      const input = `input/${id}.png`;
      const { pixels, ...augmentation } = degrade(
        data,
        width,
        height,
        `${seed}\0${id}`,
      );
      await encode(pixels).toFile(path.join(output, input));
      const record = {
        schemaVersion: 1,
        id,
        split,
        input,
        target,
        reference,
        width,
        height,
        group: item.group,
        license: item.license,
        source: item.svg,
        sourceSha256: digest,
        targetPixelSha256,
        labelKind: "source-svg",
        augmentation: { version: 1, seed, variant, ...augmentation },
      };
      await index.writeFile(`${JSON.stringify(record)}\n`, "utf8");
      written += 1;
    }
  }
} finally {
  await index.close();
}
await rename(partial, path.join(output, "manifest.jsonl"));
console.log(
  `Wrote ${written} paired examples from ${items.length} source SVGs`,
);
