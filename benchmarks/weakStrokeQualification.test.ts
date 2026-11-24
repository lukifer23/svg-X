import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { cpus } from "node:os";
import sharp from "sharp";
import { expect, test } from "vitest";
import { traceCenterlines } from "../src/core/centerline";
import {
  measureArchivalReference,
  rasterizeStroke,
} from "../tests/fixtures/archivalLoopReview";
import { centerlineOptions } from "../tests/fixtures/centerlineCorpus";
import {
  isolateOutline,
  measurePath,
  type PathReference,
} from "../tests/fixtures/scanSpanReview";
import annotations from "../tests/fixtures/qualification/weak-span-references.json";
import medallionHoldout from "../tests/fixtures/qualification/medallion-holdout-references.json";
import holdout from "../tests/fixtures/qualification/loop-holdout-references.json";
import spans from "../examples/training-data/real-scans/span-manifest.json";

const output = process.env.SVGX_WEAK_SPAN_RECORD;
const recordingBaseline = Boolean(
  output && process.env.SVGX_WEAK_SPAN_BASELINE === "1",
);

const options = { ...centerlineOptions, normalizeScanLighting: true };
const sha256 = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");

const traceImage = async (source: Buffer, limit: number) => {
  const {
    data,
    info: { width, height },
  } = await sharp(source)
    .resize(limit, limit, { fit: "inside", withoutEnlargement: true })
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = new Uint8ClampedArray(data);
  return {
    width,
    height,
    trace: () => traceCenterlines(pixels, width, height, options),
  };
};

test("retains the weak heating rail and the separately reviewed ironwork crossing", async () => {
  const ironwork: PathReference = {
    id: "iron-middle-crossing",
    // The original annotation cuts between the stroke pixels at x=26.
    // Follow the observed center through the crossing in source coordinates.
    points: [
      [8, 62],
      [22, 63],
      [32, 64],
      [43, 65],
      [53, 67],
      [61, 67],
    ],
    radius: 2,
  };
  for (const name of ["heating-1.png", "ironwork-1.png"]) {
    const scan = spans.scans.find(({ image }) => image === name)!;
    const source = await readFile(
      new URL(`../examples/training-data/real-scans/${name}`, import.meta.url),
    );
    expect(sha256(source)).toBe(scan.sha256);
    const { width, height, trace } = await traceImage(source, 1000);
    const raster = await rasterizeStroke(trace());
    const path =
      name === "heating-1.png"
        ? {
            id: scan.strokes[0].id,
            points: scan.strokes[0].points as [number, number][],
            radius: scan.strokes[0].radius,
          }
        : ironwork;
    const stroke = measurePath(raster, width, height, path);
    const gaps = scan.gaps.map((gap) =>
      measurePath(raster, width, height, {
        ...gap,
        points: gap.points as [number, number][],
      }),
    );
    const paper = measureArchivalReference(raster, width, height, {
      loops: {},
      open: {},
      paper: scan.paperRegions,
    }).paperStrokePixels;
    if (!recordingBaseline) {
      expect(stroke, path.id).toEqual({ endpoints: 2, connected: true });
      expect(gaps, name).toEqual(
        scan.gaps.map(() => ({
          endpoints: name === "heating-1.png" ? 2 : 1,
          connected: false,
        })),
      );
      expect(paper, name).toEqual(name === "heating-1.png" ? [0] : [0, 3]);
    }
  }
});

test("measures recovered loops, open gaps, paper ink and warmed trace time on independent sheets", async () => {
  const reports = [];
  for (const scan of [...annotations, ...holdout, ...medallionHoldout]) {
    const source = await readFile(
      new URL(
        `../tests/fixtures/qualification/${scan.id}.jpg`,
        import.meta.url,
      ),
    );
    expect(sha256(source), scan.id).toBe(scan.sha256);
    for (const limit of [1000, 2000]) {
      const { width, height, trace } = await traceImage(source, limit);
      const raster = await rasterizeStroke(trace());
      const scale = (x: number) => (x * width) / 1000;
      if (scan.id === "ornamental-iron" && !recordingBaseline) {
        const separations: PathReference[] = [
          {
            id: "medallion-frames-top",
            points: [
              [492, 384.5],
              [492, 389.5],
            ],
            radius: 1,
          },
          {
            id: "medallion-frames-right",
            points: [
              [532, 430],
              [537, 430],
            ],
            radius: 1,
          },
        ];
        for (const gap of separations)
          expect(
            measurePath(raster, width, height, {
              ...gap,
              points: gap.points.map(([x, y]) => [scale(x), scale(y)]),
              radius: scale(gap.radius),
            }),
            `${gap.id} at ${limit} px`,
          ).toEqual({ endpoints: 2, connected: false });
      }
      const reference = {
        loops: Object.fromEntries(
          Object.entries(scan.loops).map(([id, points]) => [
            id,
            points.map((point) => point.map(scale)),
          ]),
        ),
        open: {},
        paper: scan.paper.map((box) => box.map((x) => Math.round(scale(x)))),
      };
      const { loops, paperStrokePixels } = measureArchivalReference(
        raster,
        width,
        height,
        reference,
      );
      if ("outlineBands" in scan)
        for (const [id, radius] of Object.entries(scan.outlineBands ?? {})) {
          const outline = reference.loops[id] as [number, number][];
          loops[id] = measureArchivalReference(
            isolateOutline(raster, width, height, outline, scale(radius)),
            width,
            height,
            { loops: { [id]: outline }, open: {}, paper: [] },
          ).loops[id];
        }
      if (
        limit === 2000 &&
        "fullResolutionOutline" in scan &&
        scan.fullResolutionOutline
      ) {
        const { id, points, radius } = scan.fullResolutionOutline;
        const outline = points.map(
          ([x, y]) => [scale(x), scale(y)] as [number, number],
        );
        loops[id] = measureArchivalReference(
          isolateOutline(raster, width, height, outline, scale(radius)),
          width,
          height,
          { loops: { [id]: outline }, open: {}, paper: [] },
        ).loops[id];
      }
      const gaps = Object.fromEntries(
        scan.gaps.map(({ id, points, radius }) => [
          id,
          measurePath(raster, width, height, {
            id,
            points: points.map(([x, y]) => [scale(x), scale(y)]),
            radius: scale(radius),
          }),
        ]),
      );
      const timesMs = [];
      if (output) {
        for (let trial = 0; trial < 5; trial++) trace();
        for (let trial = 0; trial < 15; trial++) {
          const start = performance.now();
          trace();
          timesMs.push(performance.now() - start);
        }
      }
      reports.push({
        id: scan.id,
        limit,
        width,
        height,
        loops,
        gaps,
        paperStrokePixels,
        medianMs: [...timesMs].sort((a, b) => a - b)[7],
        timesMs,
      });
    }
  }
  if (output)
    await writeFile(
      `${output}.json`,
      JSON.stringify(
        { node: process.version, cpu: cpus()[0]?.model, reports },
        null,
        2,
      ) + "\n",
    );
  if (recordingBaseline) return;
  const baseline: { reports: typeof reports } = JSON.parse(
    await readFile(
      new URL("../results/medallion-recovery-before.json", import.meta.url),
      "utf8",
    ),
  );
  expect(reports).toHaveLength(baseline.reports.length);
  const recoveredAt1000: Readonly<Partial<Record<string, string>>> = {
    "north-trench": "upper-north-diamond",
    "ornamental-iron": "medallion-center",
    "boiler-fronts": "beveled-bottom-section",
  };
  for (const [index, current] of reports.entries()) {
    const previous = baseline.reports[index];
    const label = `${current.id} at ${current.limit} px`;
    if (current.id === "ornamental-iron") {
      expect(current.loops["medallion-inner-frame"].matched, label).toBe(true);
      if (current.limit === 2000)
        expect(current.loops["medallion-inner-ring"].matched, label).toBe(true);
    }
    const recovered = recoveredAt1000[current.id];
    if (current.limit === 1000 && recovered)
      expect(current.loops[recovered].matched, `${label} ${recovered}`).toBe(
        true,
      );
    expect([current.id, current.limit, current.width, current.height]).toEqual([
      previous.id,
      previous.limit,
      previous.width,
      previous.height,
    ]);
    for (const [id, loop] of Object.entries(previous.loops)) {
      if (loop.matched)
        expect(current.loops[id].matched, `${label} ${id}`).toBe(true);
      expect(current.loops[id].iou, `${label} ${id}`).toBeGreaterThanOrEqual(
        loop.iou - 0.02,
      );
    }
    for (const [id, gap] of Object.entries(previous.gaps)) {
      expect(
        current.gaps[id].endpoints,
        `${label} ${id}`,
      ).toBeGreaterThanOrEqual(gap.endpoints);
      if (!gap.connected)
        expect(current.gaps[id].connected, `${label} ${id}`).toBe(false);
    }
    for (const [index, paper] of previous.paperStrokePixels.entries())
      expect(
        current.paperStrokePixels[index],
        `${label} paper region ${index}`,
      ).toBeLessThanOrEqual(paper);
  }
}, 120_000);
