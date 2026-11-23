import { expect, test } from "vitest";
import { traceColorBoundaries } from "./colorBoundaries";
import { ringArea } from "./geometry";

test("keeps diagonal neighbors separate in both colors", () => {
  const rings = traceColorBoundaries(Uint8Array.of(0, 1, 1, 0), 2, 2, 2);

  expect(rings.map((color) => color.map(({ area }) => area))).toEqual([
    [1, 1],
    [1, 1],
  ]);
  expect(rings.map((color) => color.map(({ points }) => points[0]))).toEqual([
    [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
    [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ],
  ]);
});

test("walks a transparent hole in the opposite direction to the frame", () => {
  const masks = Uint8Array.of(0, 0, 0, 0, 255, 0, 0, 0, 0);
  const [rings] = traceColorBoundaries(masks, 3, 3, 1);

  expect(rings.map(({ area }) => area)).toEqual([9, -1]);
  expect(rings.map(({ points }) => ringArea(points))).toEqual([9, -1]);
});
