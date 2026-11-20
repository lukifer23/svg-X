import { beforeAll, expect, test } from "vitest";
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
