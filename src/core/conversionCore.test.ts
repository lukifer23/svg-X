import { describe, expect, test } from "vitest";
import { traceBlackAndWhite } from "./bwTrace";
import {
  deduplicateShapes,
  mergeComponentsToBudget,
  paletteSeeds,
  traceColorDocument,
  wuVarianceSeeds,
} from "./colorTrace";
import { walkSkeleton } from "./centerline";
import type { VectorShape, WorkerConversionOptions } from "./vectorDocument";

const options = (
  overrides: Partial<WorkerConversionOptions> = {},
): WorkerConversionOptions => ({
  mode: "bw",
  threshold: 128,
  turdSize: 0,
  turnPolicy: "minority",
  alphaMax: 1,
  optCurve: true,
  optTolerance: 0.2,
  blackOnWhite: true,
  invert: false,
  foregroundColor: "#000000",
  backgroundColor: "transparent",
  colorSteps: 3,
  fillStrategy: "dominant",
  strokeWidth: 1,
  maxPaths: 100,
  ...overrides,
});

const rgba = (
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number, number],
): Uint8ClampedArray => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1)
      data.set(pixel(x, y), (y * width + x) * 4);
  }
  return data;
};

describe("color region topology", () => {
  test("merges adjacent color islands to a path budget without dropping pixels", () => {
    const labels = Uint8Array.from([0, 1, 0, 1, 0, 1]);
    const result = mergeComponentsToBudget(
      labels,
      6,
      1,
      [
        { l: 0.5, a: 0, b: 0 },
        { l: 0.51, a: 0, b: 0 },
      ],
      2,
    );
    expect(result).toMatchObject({ initial: 6, remaining: 2, merged: 4 });
    expect([...result.labels].every((label) => label !== 255)).toBe(true);
  });

  test("reports a soft path-budget warning instead of deleting disconnected art", () => {
    const pixels = rgba(5, 1, (x) =>
      x % 2 === 0 ? [220, 30, 30, 255] : [0, 0, 0, 0],
    );
    const document = traceColorDocument(
      pixels,
      5,
      1,
      options({ mode: "color", colorSteps: 2, maxPaths: 1, optCurve: false }),
    );
    expect(document.diagnostics).toMatchObject({
      requestedMaxPaths: 1,
      outputPaths: 3,
      pathBudgetExceeded: true,
    });
    expect(document.diagnostics?.warnings).toHaveLength(1);
  });

  test("assigns every pixel to one disjoint painted region and preserves a hole", () => {
    const width = 9;
    const height = 9;
    const pixels = rgba(width, height, (x, y) => {
      const inRing =
        x >= 2 &&
        x <= 6 &&
        y >= 2 &&
        y <= 6 &&
        !(x >= 3 && x <= 5 && y >= 3 && y <= 5);
      return inRing ? [20, 80, 220, 255] : [240, 40, 40, 255];
    });
    expect(wuVarianceSeeds(pixels, 2)).toHaveLength(2);
    const document = traceColorDocument(
      pixels,
      width,
      height,
      options({ mode: "color", colorSteps: 2 }),
    );
    expect(document.shapes).toHaveLength(2);
    expect(document.shapes.every((shape) => shape.fillRule === "evenodd")).toBe(
      true,
    );
    expect(document.shapes.some((shape) => shape.subpaths.length >= 2)).toBe(
      true,
    );
    expect(
      document.shapes.some((shape) =>
        shape.subpaths.some((path) =>
          path.commands.some((command) => command.type === "C"),
        ),
      ),
    ).toBe(true);
  });

  test("deduplicates exact same-paint geometry but never geometry with different paint", () => {
    const shape: VectorShape = {
      id: "a",
      fill: "#f00",
      stroke: "none",
      strokeWidth: 0,
      opacity: 1,
      fillRule: "evenodd",
      subpaths: [
        {
          closed: true,
          commands: [
            { type: "M", x: 0, y: 0 },
            { type: "L", x: 1, y: 0 },
            { type: "L", x: 1, y: 1 },
            { type: "Z" },
          ],
        },
      ],
    };
    const result = deduplicateShapes([
      shape,
      { ...shape, id: "duplicate" },
      { ...shape, id: "different-paint", fill: "#00f" },
    ]);
    expect(result.map(({ id }) => id)).toEqual(["a", "different-paint"]);
  });

  test("honors each documented palette seed strategy", () => {
    const pixels = rgba(12, 1, (x) =>
      x < 8
        ? [8, 10, 12, 255]
        : x < 10
          ? [120, 60, 40, 255]
          : [245, 240, 30, 255],
    );
    for (const strategy of ["dominant", "mean", "median", "spread"] as const) {
      const seeds = paletteSeeds(pixels, 3, strategy);
      expect(seeds.length).toBeGreaterThanOrEqual(2);
      expect(seeds.length).toBeLessThanOrEqual(3);
    }
  });

  test("does not paint fully transparent pixels as color regions", () => {
    const document = traceColorDocument(
      rgba(2, 1, (x) => (x === 0 ? [230, 40, 50, 255] : [20, 90, 220, 0])),
      2,
      1,
      options({ mode: "color", colorSteps: 2, optCurve: false }),
    );
    expect(document.shapes).toHaveLength(1);
    const xCoordinates = document.shapes[0].subpaths[0].commands.flatMap(
      (command) =>
        command.type === "M" || command.type === "L" ? [command.x] : [],
    );
    expect(xCoordinates.every((x) => x <= 1)).toBe(true);
  });
});

describe("centerline graph walking", () => {
  test("emits open chains and reports exact T-junction topology", () => {
    const width = 7;
    const height = 7;
    const mask = new Uint8Array(width * height);
    for (let x = 1; x <= 5; x += 1) mask[2 * width + x] = 1;
    for (let y = 2; y <= 5; y += 1) mask[y * width + 3] = 1;
    const result = walkSkeleton(mask, width, height, 0);
    expect(result.stats).toEqual({ endpoints: 3, junctions: 1, cycles: 0 });
    expect(result.subpaths).toHaveLength(3);
    expect(result.subpaths.every((path) => !path.closed)).toBe(true);
  });

  test("preserves a closed loop as one closed path", () => {
    const width = 6;
    const height = 6;
    const mask = new Uint8Array(width * height);
    for (let x = 1; x <= 4; x += 1) mask[width + x] = mask[4 * width + x] = 1;
    for (let y = 2; y <= 3; y += 1)
      mask[y * width + 1] = mask[y * width + 4] = 1;
    const result = walkSkeleton(mask, width, height, 0);
    expect(result.stats).toEqual({ endpoints: 0, junctions: 0, cycles: 1 });
    expect(result.subpaths).toHaveLength(1);
    expect(result.subpaths[0].closed).toBe(true);
  });
});

describe("black and white tracing", () => {
  test("returns compound even-odd geometry for a dark ring", () => {
    const pixels = rgba(12, 12, (x, y) => {
      const dark =
        x >= 2 &&
        x <= 9 &&
        y >= 2 &&
        y <= 9 &&
        !(x >= 4 && x <= 7 && y >= 4 && y <= 7);
      return dark ? [0, 0, 0, 255] : [255, 255, 255, 255];
    });
    const result = traceBlackAndWhite(pixels, 12, 12, options());
    expect(result.shapes).toHaveLength(1);
    expect(result.shapes[0].fillRule).toBe("evenodd");
    expect(result.shapes[0].subpaths.length).toBeGreaterThanOrEqual(2);
  });

  test("emits a real background shape before foreground geometry", () => {
    const pixels = rgba(4, 4, () => [0, 0, 0, 255]);
    const result = traceBlackAndWhite(
      pixels,
      4,
      4,
      options({ backgroundColor: "#ffffff" }),
    );
    expect(result.shapes[0]).toMatchObject({
      id: "bw-background",
      fill: "#ffffff",
    });
    const commands = result.shapes[0].subpaths[0].commands;
    expect(commands[commands.length - 1].type).toBe("Z");
  });
});
