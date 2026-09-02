import { describe, expect, test } from "vitest";
import { deltaE00, meanDeltaE00, rgbToLab } from "./colorMetrics";

describe("perceptual color metrics", () => {
  test.each([
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
  ] as const)(
    "matches a published CIEDE2000 reference pair",
    (left, right, expected) => {
      expect(deltaE00(left, right)).toBeCloseTo(expected, 4);
    },
  );

  test("maps sRGB white near the D65 Lab reference", () => {
    const white = rgbToLab(255, 255, 255);
    expect(white[0]).toBeCloseTo(100, 4);
    expect(white[1]).toBeCloseTo(0, 3);
    expect(white[2]).toBeCloseTo(0, 3);
  });

  test("reports zero mean error for identical rasters", () => {
    const pixels = new Uint8Array([20, 40, 80, 200, 180, 40]);
    expect(meanDeltaE00(pixels, pixels)).toBe(0);
  });
});
