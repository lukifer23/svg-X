import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { traceCenterlines } from "../src/core/centerline";
import { rasterizeStroke } from "../tests/fixtures/archivalLoopReview";
import { centerlineOptions } from "../tests/fixtures/centerlineCorpus";

import {
  measurePath,
  type PathReference,
} from "../tests/fixtures/scanSpanReview";

interface ReviewedScan {
  image: string;
  sha256: string;
  document: string;
  split: string;
  paperRegions: [number, number, number, number][];
  strokes: PathReference[];
  gaps: PathReference[];
}

const sha256 = (contents: Uint8Array) =>
  createHash("sha256").update(contents).digest("hex");

const checkpoint = process.env.SVGX_RESTORATION_CHECKPOINT;
const manifest = process.env.SVGX_SPAN_MANIFEST;

test.skipIf(!checkpoint || !manifest)(
  "scores connectivity on documents withheld from span training",
  async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "svgx-review-spans-"));
    try {
      const contents = await readFile(manifest!);
      const data = JSON.parse(contents.toString()) as { scans: ReviewedScan[] };
      const heldOut = data.scans.filter(({ split }) => split === "test");
      expect(
        new Set(heldOut.map(({ document }) => document)).size,
      ).toBeGreaterThan(1);
      const inputs = path.join(folder, "input");
      const predictions = path.join(folder, "predictions");
      await mkdir(inputs);
      for (const { image, sha256: digest } of heldOut) {
        const source = path.join(path.dirname(manifest!), image);
        expect(sha256(await readFile(source))).toBe(digest);
        await copyFile(source, path.join(inputs, image));
      }
      execFileSync(
        process.env.SVGX_RESTORATION_PYTHON || "python",
        [
          "scripts/scan-restoration.py",
          "restore",
          checkpoint!,
          inputs,
          predictions,
        ],
        { timeout: 60_000, stdio: "inherit" },
      );
      const report = [];
      for (const scan of heldOut) {
        const {
          data: pixels,
          info: { width, height },
        } = await sharp(path.join(inputs, scan.image))
          .toColourspace("srgb")
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const guide = await sharp(path.join(predictions, scan.image))
          .greyscale()
          .raw()
          .toBuffer();
        const restored = await sharp(path.join(predictions, scan.image))
          .toColourspace("srgb")
          .ensureAlpha()
          .raw()
          .toBuffer();
        const measure = async (
          rasterPixels: Buffer,
          normalizeScanLighting: boolean,
          repairGuide?: Uint8Array,
        ) => {
          const document = traceCenterlines(
            new Uint8ClampedArray(rasterPixels),
            width,
            height,
            { ...centerlineOptions, normalizeScanLighting },
            repairGuide,
          );
          const raster = await rasterizeStroke(document);
          const strokes = scan.strokes.map((item) => ({
            id: item.id,
            ...measurePath(raster, width, height, item),
          }));
          const gaps = scan.gaps.map((item) => ({
            id: item.id,
            ...measurePath(raster, width, height, item),
          }));
          let grain = 0;
          for (const [left, top, right, bottom] of scan.paperRegions)
            for (let y = top; y < bottom; y += 1)
              for (let x = left; x < right; x += 1)
                grain += Number(raster[y * width + x] >= 64);
          return { strokes, gaps, grain };
        };
        report.push({
          image: scan.image,
          document: scan.document,
          production: await measure(pixels, true),
          guided: await measure(pixels, true, guide),
          learned: await measure(restored, false),
        });
      }
      const totals = (mode: "production" | "guided" | "learned") => ({
        connectedStrokes: report
          .flatMap((row) => row[mode].strokes)
          .filter((stroke) => stroke.connected).length,
        falseJoins: report
          .flatMap((row) => row[mode].gaps)
          .filter((gap) => gap.connected).length,
        missingGapAnchors: report
          .flatMap((row) => row[mode].gaps)
          .filter((gap) => gap.endpoints < 2).length,
        grain: report.reduce((total, row) => total + row[mode].grain, 0),
      });
      const results = {
        spanManifestSha256: sha256(contents),
        checkpointSha256: sha256(await readFile(checkpoint!)),
        production: totals("production"),
        guided: totals("guided"),
        learned: totals("learned"),
        gates: {
          preservesStrokes: report.every((row) =>
            row.production.strokes.every(
              (stroke, index) =>
                !stroke.connected || row.guided.strokes[index].connected,
            ),
          ),
          preservesGapAnchors: report.every((row) =>
            row.production.gaps.every(
              (gap, index) => row.guided.gaps[index].endpoints >= gap.endpoints,
            ),
          ),
          addsNoFalseJoins: report.every((row) =>
            row.production.gaps.every(
              (gap, index) =>
                gap.connected || !row.guided.gaps[index].connected,
            ),
          ),
          addsNoGrain: report.every(
            (row) => row.guided.grain <= row.production.grain,
          ),
        },
        report,
      };
      await writeFile(
        process.env.SVGX_SPAN_REPORT ||
          "results/scan-restoration-spans-local.json",
        JSON.stringify(results, null, 2) + "\n",
      );
      console.log({ production: results.production, guided: results.guided });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  },
  120_000,
);
