import { beforeAll, expect, test } from "vitest";
import {
  centerlineCorpus,
  centerlineOptions,
  measureCenterlines,
  type CenterlineCase,
} from "../../tests/fixtures/centerlineCorpus";
import { thinBinaryMask, traceCenterlines, walkSkeleton } from "./centerline";

let cases: CenterlineCase[];
beforeAll(async () => {
  cases = await centerlineCorpus();
});

test.each([false, true])(
  "preserves clean artwork topology with curve fitting %s",
  (optCurve) => {
    for (const { name, image, reference, topology } of cases.slice(0, 3)) {
      const document = traceCenterlines(
        image.pixels,
        image.width,
        image.height,
        {
          ...centerlineOptions,
          optCurve,
          optTolerance: 2,
        },
      );
      const report = measureCenterlines(document, reference);
      expect(report, name).toMatchObject(topology!);
      expect(report.tracedToSource?.mean, name).toBeLessThan(0.35);
      expect(report.sourceToTraced?.mean, name).toBeLessThan(0.25);
      if (name === "loops") {
        const closed = document.shapes
          .flatMap(({ subpaths }) => subpaths)
          .filter(({ closed }) => closed);
        expect(closed).toHaveLength(2);
        expect(
          closed.every(
            ({ commands }) => commands[commands.length - 1]?.type === "Z",
          ),
        ).toBe(true);
      }
    }
  },
);

test.each([false, true])(
  "reduces noisy scan artifacts with curve fitting %s",
  (optCurve) => {
    const { image, reference } = cases.find(
      ({ name }) => name === "noisy-scan",
    )!;
    const render = (turdSize: number) =>
      measureCenterlines(
        traceCenterlines(image.pixels, image.width, image.height, {
          ...centerlineOptions,
          optCurve,
          turdSize,
        }),
        reference,
      );
    const disabled = render(0);
    const defaults = render(2);
    const scan = render(8);
    expect(defaults.paths).toBeLessThan(disabled.paths / 10);
    expect(defaults.tracedToSource?.mean).toBeLessThan(0.4);
    expect(scan.tracedToSource?.mean).toBeLessThanOrEqual(
      defaults.tracedToSource!.mean,
    );
    expect(scan.sourceToTraced?.mean).toBeLessThan(0.2);
    expect(scan.loops).toBe(2);
  },
);

test("counts a loop that runs through multiple junctions", () => {
  const width = 8;
  const mask = new Uint8Array(width * width);
  for (let x = 1; x <= 6; x += 1) mask[2 * width + x] = mask[5 * width + x] = 1;
  for (let y = 2; y <= 5; y += 1) mask[y * width + 1] = mask[y * width + 6] = 1;
  mask[width + 3] = mask[6 * width + 4] = 1;
  expect(
    walkSkeleton(thinBinaryMask(mask, width, width), width, width).stats,
  ).toEqual({ endpoints: 2, junctions: 2, cycles: 1 });
});

test("keeps the mechanism artwork's loops when scan grain is added", () => {
  const measure = (name: string) => {
    const { image } = cases.find((entry) => entry.name === name)!;
    return measureCenterlines(
      traceCenterlines(
        image.pixels,
        image.width,
        image.height,
        centerlineOptions,
      ),
    );
  };
  const clean = measure("mechanism-artwork");
  const grain = measure("mechanism-grain");
  expect(clean).toMatchObject({ paths: 128, loops: 40 });
  expect(grain.loops).toBe(clean.loops);
  expect(grain.paths).toBeLessThan(3 * clean.paths);
});

test("keeps the archived drawing's four loops and offers a fine-detail setting", () => {
  const { image } = cases.find(({ name }) => name === "wright-patent-scan")!;
  const trace = (turdSize: number) =>
    measureCenterlines(
      traceCenterlines(image.pixels, image.width, image.height, {
        ...centerlineOptions,
        turdSize,
      }),
    );
  const cleaned = trace(2);
  const detail = trace(0);
  expect(cleaned.loops).toBe(4);
  expect(detail.loops).toBe(4);
  expect(detail.paths).toBeGreaterThan(cleaned.paths);
});

test.each([false, true])(
  "keeps dark fine linework and drops equal-size grain in inverse polarity %s",
  (invert) => {
    const { image, reference, topology } = cases.find(
      ({ name }) => name === "fine-linework",
    )!;
    const pixels = image.pixels.map((value, index) =>
      invert && index % 4 !== 3 ? 255 - value : value,
    );
    const traced = traceCenterlines(pixels, image.width, image.height, {
      ...centerlineOptions,
      invert,
    });
    const report = measureCenterlines(traced, reference);
    expect(report).toMatchObject({ ...topology, paths: 4 });
    expect(report.tracedToSource?.mean).toBeLessThan(0.05);
    expect(report.sourceToTraced?.mean).toBeLessThan(0.05);
  },
);

test.each([
  ["velocipede-patent-scan", 33],
  ["marconi-patent-scan", 0],
] as const)("keeps the archived %s topology", (name, loops) => {
  const { image } = cases.find((item) => item.name === name)!;
  const report = measureCenterlines(
    traceCenterlines(
      image.pixels,
      image.width,
      image.height,
      centerlineOptions,
    ),
  );
  expect(report.loops).toBe(loops);
  expect(report.paths).toBeGreaterThan(75);
});
