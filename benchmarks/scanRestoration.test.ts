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
import { cpus, tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { traceCenterlines } from "../src/core/centerline";
import { serializeVectorDocument } from "../src/core/serialize";
import {
  enclosedRegions,
  measureArchivalReference,
  rasterizeStroke,
} from "../tests/fixtures/archivalLoopReview";
import { centerlineOptions } from "../tests/fixtures/centerlineCorpus";
import freshReferences from "../tests/fixtures/qualification/fresh-references.json";
import perimeterReferences from "../tests/fixtures/qualification/perimeter-references.json";
import references from "../tests/fixtures/qualification/references.json";

const checkpoint = process.env.SVGX_RESTORATION_CHECKPOINT;
const median = (samples: number[]) => {
  const sorted = samples.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

test.skipIf(!checkpoint)(
  "compares learned cleanup against production on archival scans",
  async () => {
    const temp = await mkdtemp(path.join(tmpdir(), "svgx-restoration-"));
    try {
      const input = path.join(temp, "input");
      const output = path.join(temp, "output");
      const previewDirectory = process.env.SVGX_RESTORATION_PREVIEWS;
      await mkdir(input);
      if (previewDirectory) await mkdir(previewDirectory);
      const cases = [];
      for (const reference of [
        ...references,
        ...freshReferences,
        ...perimeterReferences,
      ]) {
        const source = await readFile(
          `tests/fixtures/qualification/${reference.id}.jpg`,
        );
        for (const limit of [1000, 2000]) {
          const name = `${reference.id}-${limit}`;
          await sharp(source)
            .resize(limit, limit, { fit: "inside", withoutEnlargement: true })
            .png()
            .toFile(path.join(input, `${name}.png`));
          cases.push({
            reference,
            limit,
            name,
            sourceSha256: createHash("sha256").update(source).digest("hex"),
          });
        }
      }
      execFileSync(
        process.env.SVGX_RESTORATION_PYTHON || "python",
        ["scripts/scan-restoration.py", "restore", checkpoint!, input, output],
        { timeout: 180_000, stdio: "inherit" },
      );
      const inference = JSON.parse(
        await readFile(path.join(output, "inference.json"), "utf8"),
      ) as {
        checkpointStep: number;
        checkpointSha256: string;
        threads: number;
        tile: number;
        inferenceMs: Record<string, number[]>;
      };
      const report = [];
      for (const { reference, limit, name, sourceSha256 } of cases) {
        const load = async (folder: string) =>
          sharp(path.join(folder, `${name}.png`))
            .toColourspace("srgb")
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
        const {
          data,
          info: { width, height },
        } = await load(input);
        const restored = await load(output);
        expect([
          restored.info.width,
          restored.info.height,
          restored.info.channels,
        ]).toEqual([width, height, 4]);
        const scale = (coordinate: number) =>
          Math.round((coordinate * width) / reference.referenceWidth);
        const annotations = {
          loops: Object.fromEntries(
            Object.entries(reference.loops).map(([id, points]) => [
              id,
              points.map((point) => point.map(scale)),
            ]),
          ),
          open: {},
          paper: reference.paper.map((box) => box.map(scale)),
        };
        const evaluate = async (
          pixels: Buffer,
          normalizeScanLighting: boolean,
          repairGuide?: Uint8Array,
          exportName?: string,
        ) => {
          const rgba = new Uint8ClampedArray(pixels);
          const trace = () =>
            traceCenterlines(
              rgba,
              width,
              height,
              {
                ...centerlineOptions,
                normalizeScanLighting,
              },
              repairGuide,
            );
          const document = trace();
          const samplesMs = Array.from({ length: 3 }, () => {
            const start = performance.now();
            trace();
            return performance.now() - start;
          });
          const stroke = await rasterizeStroke(document);
          if (exportName && previewDirectory)
            await writeFile(
              path.join(previewDirectory, `${name}-${exportName}.svg`),
              serializeVectorDocument(document),
              { flag: "wx" },
            );
          const geometry = measureArchivalReference(
            stroke,
            width,
            height,
            annotations,
          );
          const open = Object.fromEntries(
            Object.entries(reference.open).map(([id, { box, point }]) => {
              const [left, top, right, bottom] = box.map(scale);
              const [x, y] = point.map(scale);
              const cropWidth = right - left;
              const cropHeight = bottom - top;
              const crop = Buffer.alloc(cropWidth * cropHeight);
              for (let row = top; row < bottom; row += 1)
                stroke.copy(
                  crop,
                  (row - top) * cropWidth,
                  row * width + left,
                  row * width + right,
                );
              const { labels, exterior } = enclosedRegions(
                crop,
                cropWidth,
                cropHeight,
              );
              return [id, exterior[labels[(y - top) * cropWidth + x - left]]];
            }),
          );
          const inkHits = reference.ink.map(([x, y]) => {
            const px = scale(x);
            const py = scale(y);
            const tolerance = Math.max(2, scale(2));
            for (
              let row = Math.max(0, py - tolerance);
              row <= Math.min(height - 1, py + tolerance);
              row += 1
            )
              for (
                let column = Math.max(0, px - tolerance);
                column <= Math.min(width - 1, px + tolerance);
                column += 1
              )
                if (stroke[row * width + column] >= 64) return true;
            return false;
          });
          return {
            loops: geometry.loops,
            paperStrokePixels: geometry.paperStrokePixels,
            open,
            inkHits,
            traceMs: median(samplesMs),
            samplesMs,
          };
        };
        const raw = await evaluate(data, false);
        const current = await evaluate(data, true, undefined, "production");
        const learned = await evaluate(
          restored.data,
          false,
          undefined,
          "learned",
        );
        const hybrid = await evaluate(restored.data, true, undefined, "hybrid");
        const guide = Uint8Array.from(
          { length: width * height },
          (_, index) => restored.data[index * 4],
        );
        const guided = await evaluate(data, true, guide, "guided");
        if (previewDirectory)
          await Promise.all([
            copyFile(
              path.join(input, `${name}.png`),
              path.join(previewDirectory, `${name}-source.png`),
            ),
            copyFile(
              path.join(output, `${name}.png`),
              path.join(previewDirectory, `${name}-restored.png`),
            ),
          ]);
        report.push({
          name,
          limit,
          sourceSha256,
          width,
          height,
          raw,
          current,
          learned,
          hybrid,
          guided,
          addedMs:
            median(inference.inferenceMs[name]) +
            learned.traceMs -
            current.traceMs,
          hybridAddedMs:
            median(inference.inferenceMs[name]) +
            hybrid.traceMs -
            current.traceMs,
          guidedAddedMs:
            median(inference.inferenceMs[name]) +
            guided.traceMs -
            current.traceMs,
        });
      }
      const countLoops = (
        mode: "raw" | "current" | "learned" | "hybrid" | "guided",
      ) =>
        report.reduce(
          (sum, row) =>
            sum +
            Object.values(row[mode].loops).filter((loop) => loop.matched)
              .length,
          0,
        );
      const loops = {
        raw: countLoops("raw"),
        current: countLoops("current"),
        learned: countLoops("learned"),
        hybrid: countLoops("hybrid"),
        guided: countLoops("guided"),
      };
      const evaluateGates = (candidate: "learned" | "hybrid" | "guided") => ({
        gainsLoops: loops[candidate] > loops.current,
        preservesMatchedLoops: report.every((row) =>
          Object.entries(row.current.loops).every(
            ([id, loop]) => !loop.matched || row[candidate].loops[id].matched,
          ),
        ),
        preservesOpenGaps: report.every((row) =>
          Object.entries(row.current.open).every(
            ([id, open]) => !open || row[candidate].open[id],
          ),
        ),
        addsNoPaperInk: report.every((row) =>
          row.current.paperStrokePixels.every(
            (ink, index) => row[candidate].paperStrokePixels[index] <= ink,
          ),
        ),
        preservesInk: report.every((row) =>
          row.current.inkHits.every(
            (hit, index) => !hit || row[candidate].inkHits[index],
          ),
        ),
        fitsCpuBudget: report.every(
          ({ limit, addedMs, hybridAddedMs, guidedAddedMs }) => {
            const times = {
              learned: addedMs,
              hybrid: hybridAddedMs,
              guided: guidedAddedMs,
            };
            return times[candidate] <= (limit === 1000 ? 250 : 750);
          },
        ),
      });
      const gates = {
        learned: evaluateGates("learned"),
        hybrid: evaluateGates("hybrid"),
        guided: evaluateGates("guided"),
      };
      expect(report).toHaveLength(14);
      expect(
        report.every(({ addedMs, hybridAddedMs, guidedAddedMs }) =>
          [addedMs, hybridAddedMs, guidedAddedMs].every(Number.isFinite),
        ),
      ).toBe(true);
      const results = {
        schemaVersion: 2,
        cpu: cpus()[0]?.model,
        platform: process.platform,
        node: process.version,
        ...inference,
        loops,
        gates,
        qualified: {
          learned: Object.values(gates.learned).every(Boolean),
          hybrid: Object.values(gates.hybrid).every(Boolean),
          guided: Object.values(gates.guided).every(Boolean),
        },
        report,
      };
      await writeFile(
        process.env.SVGX_RESTORATION_REPORT ||
          "results/scan-restoration-local.json",
        JSON.stringify(results, null, 2) + "\n",
      );
      console.log({ loops, gates, qualified: results.qualified });
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  },
  240_000,
);
