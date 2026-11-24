import { expect, test } from "vitest";
import { repairFadedCurves } from "./fadedCurveRepair";

test("an ink guide can bridge a weak observed stroke but cannot bridge erased paper", () => {
  const width = 32;
  const height = 16;
  const row = 8 * width;
  const first = row + 12;
  const last = row + 18;
  const directions = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
  ];
  const trace = (gapContrast: number, useGuide: boolean) => {
    const skeleton = new Uint8Array(width * height);
    skeleton.fill(1, row + 4, first + 1);
    skeleton.fill(1, last, row + 28);
    const contrast = Uint8Array.from(skeleton, (value) => value * 150);
    contrast.fill(gapContrast, first + 1, last);
    const guide = new Uint8Array(width * height).fill(255);
    guide.fill(48, first + 1, last);
    const neighborsAt = (index: number) =>
      directions.reduce(
        (bits, [dx, dy], direction) =>
          bits | ((skeleton[index + dy * width + dx] ?? 0) << direction),
        0,
      );
    repairFadedCurves(
      skeleton,
      width,
      height,
      { contrast, minimumContrast: 16, resolutionScale: 1 },
      neighborsAt,
      useGuide ? guide : undefined,
    );
    return Array.from(skeleton.subarray(first + 1, last));
  };
  expect(trace(4, false)).toEqual([0, 0, 0, 0, 0]);
  expect(trace(4, true)).toEqual([1, 1, 1, 1, 1]);
  expect(trace(0, true)).toEqual([0, 0, 0, 0, 0]);
});
