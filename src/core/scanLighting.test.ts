import { beforeAll, expect, test } from "vitest";
import {
  archivalReferences,
  measureArchivalReference,
  measureVelocipedeRim,
  rasterizeStroke,
} from "../../tests/fixtures/archivalLoopReview";
import {
  centerlineOptions,
  measureCenterlines,
} from "../../tests/fixtures/centerlineCorpus";
import {
  emulateFadedScan,
  scanLightingCorpus,
  type ScanPair,
} from "../../tests/fixtures/scanLightingCorpus";
import { traceCenterlines } from "./centerline";
import { traceScanInk } from "./scanLighting";

let pairs: ScanPair[];
beforeAll(async () => {
  pairs = await scanLightingCorpus();
});

test.each([
  ["wright-patent-scan", ["upper-truss"], [0, 0]],
  ["wright-patent-scan-faded", ["right-lower-bracing"], [0, 0]],
  [
    "velocipede-patent-scan",
    ["front-wheel-rim", "rear-wheel-seat-sector"],
    [0, 0, 2],
  ],
  ["velocipede-patent-scan-faded", ["front-wheel-rim"], [0, 0, 0]],
  ["marconi-patent-scan", ["fig-g-counter"], [0, 0, 0]],
  ["marconi-patent-scan-faded", [], [0, 0, 0]],
] as const)(
  "preserves reviewed geometry in %s",
  async (name, required, maxPaper) => {
    const { scan, clean } = pairs.find((pair) => pair.name === name)!;
    const { width, height, pixels } = scan;
    const trace = traceCenterlines(pixels, width, height, {
      ...centerlineOptions,
      normalizeScanLighting: true,
    });
    const review = measureArchivalReference(
      await rasterizeStroke(trace),
      width,
      height,
      archivalReferences[clean.name]!,
    );
    for (const id of required) expect(review.loops[id].matched, id).toBe(true);
    for (const [id, open] of Object.entries(review.open)) {
      // The unmodified Marconi crop already has an unwanted plate closure.
      // Allow a future implementation to fix it.
      if (name === "marconi-patent-scan" && id === "second-capacitor") continue;
      expect(open, id).toBe(true);
    }
    for (const [index, count] of review.paperStrokePixels.entries())
      expect(count, `paper zone ${index + 1}`).toBeLessThanOrEqual(
        maxPaper[index],
      );
  },
);

test.each([false, true])(
  "recovers the faded Velocipede rim as a separate loop (curve fitting %s)",
  async (optCurve) => {
    const {
      scan: { pixels, width, height },
    } = pairs.find(({ name }) => name === "velocipede-patent-scan-faded")!;
    const document = traceCenterlines(pixels, width, height, {
      ...centerlineOptions,
      normalizeScanLighting: true,
      optCurve,
    });
    const review = await measureVelocipedeRim(
      document,
      await rasterizeStroke(document),
    );
    expect(review.closedSubpathIoU).toBeGreaterThan(0.9);
    expect(review.forkBodyRimPixels).toBe(0);
    expect(review.forkMarksPresent).toBe(8);
    expect(review.forkContactPixels).toBeGreaterThan(0);
    expect(review.rimPaperStrokePixels).toEqual([0, 0]);
  },
);

test("leaves the archival rim open when a long arc has no ink", async () => {
  const { clean } = pairs.find(
    ({ name }) => name === "velocipede-patent-scan-faded",
  )!;
  const { width, height } = clean.image;
  const pixels = clean.image.pixels.slice();
  // Erase the rightmost arc before applying the standard fade and grain.
  for (let y = 140; y < 172; y += 1)
    for (let x = 234; x < 246; x += 1)
      pixels.set(
        pixels.subarray((y * width + 248) * 4, (y * width + 249) * 4),
        (y * width + x) * 4,
      );
  const scan = emulateFadedScan({ pixels, width, height });
  const trace = traceCenterlines(scan.pixels, width, height, {
    ...centerlineOptions,
    normalizeScanLighting: true,
  });
  const review = measureArchivalReference(
    await rasterizeStroke(trace),
    width,
    height,
    archivalReferences[clean.name]!,
  );
  expect(review.loops["front-wheel-rim"].matched).toBe(false);
});

test.each(["close-parallel-faded", "junctions-faded"])(
  "recovers %s across a shadow without tracing the grain",
  (name) => {
    const { scan, clean } = pairs.find((pair) => pair.name === name)!;
    const document = traceCenterlines(scan.pixels, scan.width, scan.height, {
      ...centerlineOptions,
      normalizeScanLighting: true,
    });
    const report = measureCenterlines(document, clean.reference);
    expect(report).toMatchObject(clean.topology!);
    expect(report.tracedToSource?.mean).toBeLessThan(0.1);
    expect(report.sourceToTraced?.mean).toBeLessThan(0.6);
  },
);

test("leaves shadowed paper and isolated grain blank", () => {
  const width = 240;
  const height = 176;
  const paper = emulateFadedScan({
    pixels: new Uint8ClampedArray(width * height * 4).fill(255),
    width,
    height,
  });
  const document = traceCenterlines(paper.pixels, width, height, {
    ...centerlineOptions,
    normalizeScanLighting: true,
  });
  expect(document.shapes).toHaveLength(0);
});

test("handles a single paper tile and cropped boundaries", () => {
  const width = 10;
  const height = 10;
  const tones = new Uint8Array(width * height).fill(180);
  tones.fill(155, 5 * width, 6 * width);
  const { mask } = traceScanInk(tones, width, height, 128, true);
  expect(mask.reduce((sum, value) => sum + value, 0)).toBe(width);
});

test.each([false, true])(
  "repairs faded nested loops with curve fitting %s",
  (optCurve) => {
    const { scan, clean } = pairs.find(
      ({ name }) => name === "curved-loops-faded",
    )!;
    const document = traceCenterlines(scan.pixels, scan.width, scan.height, {
      ...centerlineOptions,
      optCurve,
      normalizeScanLighting: true,
    });
    const report = measureCenterlines(document, clean.reference);
    expect(report).toMatchObject({ ...clean.topology, paths: 3 });
    expect(report.tracedToSource?.outside).toBeLessThan(0.01);
    expect(report.sourceToTraced?.outside).toBeLessThan(0.01);
    expect(
      document.shapes
        .flatMap(({ subpaths }) => subpaths)
        .every(({ closed }) => closed),
    ).toBe(true);
  },
);

test("leaves fully erased arcs open even when grain falls in the gaps", () => {
  const { scan, clean } = pairs.find(
    ({ name }) => name === "curved-loops-faded",
  )!;
  const pixels = scan.pixels.slice();
  const paper = emulateFadedScan({
    ...scan,
    pixels: new Uint8ClampedArray(pixels.length).fill(255),
  });
  for (let y = 0; y < 40; y += 1) {
    const start = (y * scan.width + 35) * 4;
    pixels.set(paper.pixels.subarray(start, start + 10 * 4), start);
  }
  const document = traceCenterlines(pixels, scan.width, scan.height, {
    ...centerlineOptions,
    normalizeScanLighting: true,
  });
  const report = measureCenterlines(document, clean.reference);
  expect(report.loops).toBeLessThan(3);
  expect(report.junctions).toBe(0);
  expect(report.tracedToSource?.outside).toBeLessThan(0.01);
});

test("recovers more graph cycles on the faded mechanism artwork", () => {
  const { scan } = pairs.find(
    ({ name }) => name === "mechanism-artwork-faded",
  )!;
  const document = traceCenterlines(scan.pixels, scan.width, scan.height, {
    ...centerlineOptions,
    normalizeScanLighting: true,
  });
  expect(measureCenterlines(document).loops).toBeGreaterThan(4);
});
