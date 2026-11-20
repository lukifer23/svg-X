import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { cpus, platform } from "node:os";
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
import references from "../tests/fixtures/qualification/references.json";
import freshReferences from "../tests/fixtures/qualification/fresh-references.json";

const baselineUrl = new URL(
  "../results/archival-scale-before.json",
  import.meta.url,
);
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const recoveredAtFullSize: Readonly<Partial<Record<string, string[]>>> = {
  telephone: ["lower-box-face"],
  "multiple-telegraph": ["lower-transmitter-terminal", "receiver-block"],
};

test("qualifies centerline against separately annotated archival drawings", async () => {
  const timing = process.env.SVGX_QUALIFICATION_TIMING === "1";
  const recording = process.env.SVGX_QUALIFICATION_REPORT;
  const reports = [];
  for (const reference of [...references, ...freshReferences]) {
    const source = await readFile(
      new URL(
        `../tests/fixtures/qualification/${reference.id}.jpg`,
        import.meta.url,
      ),
    );
    for (const limit of [1000, 2000]) {
      const {
        data,
        info: { width, height },
      } = await sharp(source)
        .resize(limit, limit, { fit: "inside", withoutEnlargement: true })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const pixels = new Uint8ClampedArray(data);
      const trace = () =>
        traceCenterlines(pixels, width, height, {
          ...centerlineOptions,
          normalizeScanLighting: true,
        });
      const samplesMs = [];
      if (timing) {
        for (let warmup = 0; warmup < 5; warmup += 1) trace();
        for (let trial = 0; trial < 20; trial += 1) {
          const start = performance.now();
          trace();
          samplesMs.push(performance.now() - start);
        }
      }
      const scaled = (coordinate: number) =>
        Math.round((coordinate * width) / reference.referenceWidth);
      const mapPoints = (features: Record<string, number[][]>) =>
        Object.fromEntries(
          Object.entries(features).map(([id, points]) => [
            id,
            points.map((point) => point.map(scaled)),
          ]),
        );
      const document = trace();
      const stroke = await rasterizeStroke(document);
      const annotations = {
        loops: mapPoints(reference.loops),
        open: {},
        paper: reference.paper.map((box) => box.map(scaled)),
      };
      const geometry = measureArchivalReference(
        stroke,
        width,
        height,
        annotations,
      );
      const comparableStrokeWidth = Math.max(width, height) / 1000;
      const comparableStroke = await sharp(
        Buffer.from(
          serializeVectorDocument({
            ...document,
            shapes: document.shapes.map((shape) => ({
              ...shape,
              strokeWidth: comparableStrokeWidth,
            })),
          }),
        ),
      )
        .extractChannel("alpha")
        .raw()
        .toBuffer();
      const comparableLoops = measureArchivalReference(
        comparableStroke,
        width,
        height,
        annotations,
      ).loops;
      const open = Object.fromEntries(
        Object.entries(reference.open).map(([feature, { box, point }]) => {
          const [left, top, right, bottom] = box.map(scaled);
          const [x, y] = point.map(scaled);
          const cropWidth = right - left;
          const crop = Buffer.alloc(cropWidth * (bottom - top));
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
            bottom - top,
          );
          return [feature, exterior[labels[(y - top) * cropWidth + x - left]]];
        }),
      );
      const inkHits = reference.ink.map(([x, y]) => {
        const px = scaled(x);
        const py = scaled(y);
        const tolerance = Math.max(2, scaled(2));
        for (let row = py - tolerance; row <= py + tolerance; row += 1)
          for (
            let column = px - tolerance;
            column <= px + tolerance;
            column += 1
          )
            if (stroke[row * width + column] >= 64) return true;
        return false;
      });
      const sorted = [...samplesMs].sort((a, b) => a - b);
      reports.push({
        id: reference.id,
        limit,
        width,
        height,
        sourceSha256: sha256(source),
        inputSha256: sha256(pixels),
        ...geometry,
        comparableLoops,
        open,
        inkHits,
        ...(timing && {
          medianMs: (sorted[9] + sorted[10]) / 2,
          p95Ms: sorted[18],
          samplesMs,
        }),
      });
    }
  }
  if (recording) {
    await writeFile(
      recording,
      JSON.stringify(
        {
          platform: platform(),
          cpu: cpus()[0]?.model,
          node: process.version,
          reports,
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
  }
  if (recording && !existsSync(baselineUrl)) return;
  const baseline: { reports: typeof reports } = JSON.parse(
    await readFile(baselineUrl, "utf8"),
  );
  expect(reports).toHaveLength(baseline.reports.length);
  for (const [index, previous] of baseline.reports.entries()) {
    const current = reports[index];
    const label = `${current.id} at ${current.limit} px`;
    expect(current.sourceSha256, label).toBe(previous.sourceSha256);
    expect(
      [current.id, current.limit, current.width, current.height],
      label,
    ).toEqual([previous.id, previous.limit, previous.width, previous.height]);
    for (const [feature, result] of Object.entries(previous.loops)) {
      if (result.matched)
        expect(current.loops[feature].matched, `${label} ${feature}`).toBe(
          true,
        );
      expect(
        current.loops[feature].iou,
        `${label} ${feature}`,
      ).toBeGreaterThanOrEqual(result.iou - 0.02);
    }
    if (current.limit === 2000) {
      for (const feature of recoveredAtFullSize[current.id] ?? []) {
        expect(current.loops[feature].matched, `${label} ${feature}`).toBe(
          true,
        );
        expect(
          current.comparableLoops[feature].matched,
          `${label} ${feature} at matched stroke scale`,
        ).toBe(true);
      }
    }
    for (const [feature, open] of Object.entries(previous.open))
      if (open) expect(current.open[feature], `${label} ${feature}`).toBe(true);
    for (const [mark, hit] of previous.inkHits.entries())
      if (hit)
        expect(current.inkHits[mark], `${label} ink checkpoint ${mark}`).toBe(
          true,
        );
    for (const [zone, pixels] of previous.paperStrokePixels.entries())
      expect(
        current.paperStrokePixels[zone],
        `${label} paper ${zone}`,
      ).toBeLessThanOrEqual(pixels);
  }
}, 120_000);
