import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import sharp from "sharp";
import { expect, test } from "vitest";
import { meanDeltaE00 } from "../src/core/colorMetrics";
import { traceColorDocument } from "../src/core/colorTrace";
import { serializeVectorDocument } from "../src/core/serialize";
import { benchOptions } from "./support";

const compareVTracer = String.raw`
import importlib.metadata, json, sys, time
import vtracer
data = sys.stdin.buffer.read()
def convert():
    return vtracer.convert_raw_image_to_svg(
        data, img_format="png", colormode="color", hierarchical="stacked", mode="spline")
for _ in range(2):
    convert()
ms = []
for _ in range(5):
    start = time.perf_counter()
    svg = convert()
    ms.append((time.perf_counter() - start) * 1000)
print(json.dumps(dict(svg=svg, samplesMs=ms, version=importlib.metadata.version("vtracer"))))
`;

const hash = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");

const python = process.env.SVGX_VTRACER_PYTHON;
test.skipIf(!python)("compares fitted Color to VTracer Classic on the same four inputs", async () => {
  const fixtures = [
    "color-bicycle.png",
    "realistic-still-life.png",
    "usda-fresh-produce.jpg",
    "usfws-rufous-hummingbird.jpg",
  ];
  const report = [];
  let version = "";
  for (const file of fixtures) {
    const working = await sharp(`tests/fixtures/review/${file}`)
      .resize(1000, 1000, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#fff" })
      .png()
      .toBuffer();
    const { data: source, info } = await sharp(working)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const compare = async (svg: string, samplesMs: number[]) => {
      const { data: rendered, info: renderedInfo } = await sharp(Buffer.from(svg))
        .flatten({ background: "#fff" })
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect([renderedInfo.width, renderedInfo.height, renderedInfo.channels])
        .toEqual([info.width, info.height, 3]);
      expect(svg).toContain("<path");
      return {
        medianMs: samplesMs.slice().sort((a, b) => a - b)[2],
        samplesMs,
        svgBytes: Buffer.byteLength(svg),
        svgSha256: hash(svg),
        meanDeltaE00: meanDeltaE00(source, rendered),
      };
    };
    const svgx = [];
    for (const colorSteps of [8, 16]) {
      const convert = async () => {
        const rgba = await sharp(working).ensureAlpha().raw().toBuffer();
        const document = traceColorDocument(
          new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength),
          info.width,
          info.height,
          { ...benchOptions, optCurve: true, colorSteps },
        );
        return serializeVectorDocument(document, { compact: true });
      };
      await convert();
      await convert();
      const samplesMs = [];
      let svg = "";
      for (let sample = 0; sample < 5; sample += 1) {
        const start = performance.now();
        svg = await convert();
        samplesMs.push(performance.now() - start);
      }
      svgx.push({ colorSteps, ...(await compare(svg, samplesMs)) });
    }
    const classic = JSON.parse(
      execFileSync(python!, ["-c", compareVTracer], {
        input: working,
        encoding: "utf8",
        maxBuffer: 50 * 1024 * 1024,
        timeout: 60_000,
      }),
    ) as { svg: string; samplesMs: number[]; version: string };
    version = classic.version;
    report.push({
      file,
      width: info.width,
      height: info.height,
      inputSha256: hash(working),
      svgx,
      vtracerClassic: await compare(classic.svg, classic.samplesMs),
    });
  }
  await writeFile(
    process.env.SVGX_COMPETITIVE_REPORT ?? "results/competitive-color-local.json",
    `${JSON.stringify({ platform: process.platform, cpu: cpus()[0]?.model.trim(), node: process.version, vtracerVersion: version, report }, null, 2)}\n`,
  );
}, 120_000);
