import { describe, expect, test } from "vitest";
import {
  compositeRgbaOverWhite,
  simplifyForNetworkClients,
  DEFAULT_PARAMS,
  getOptimizedFilename,
} from "./imageProcessor";

describe("RGBA normalization", () => {
  test("copies opaque pixels and composites mixed alpha without mutating the caller", () => {
    const original = [18, 72, 210, 255, 0, 100, 200, 128];
    const input = new Uint8ClampedArray(original);
    const output = compositeRgbaOverWhite(input);
    expect([...output]).toEqual([18, 72, 210, 255, 127, 177, 227, 255]);
    expect([...input]).toEqual(original);
    expect(output.buffer).not.toBe(input.buffer);
  });

  test("composites transparent and partial-alpha pixels over white", () => {
    expect([
      ...compositeRgbaOverWhite(new Uint8ClampedArray([20, 40, 60, 0])),
    ]).toEqual([255, 255, 255, 255]);
    expect([
      ...compositeRgbaOverWhite(new Uint8ClampedArray([0, 100, 200, 128])),
    ]).toEqual([127, 177, 227, 255]);
  });
});

describe("simplifyForNetworkClients", () => {
  test("preserves every conversion parameter across transports", () => {
    const params = { ...DEFAULT_PARAMS, threshold: 128 };
    const result = simplifyForNetworkClients(params);
    expect(result).toEqual(params);
    expect(result).not.toBe(params);
  });
});

describe("getOptimizedFilename", () => {
  test("slugifies complex filenames safely", () => {
    expect(getOptimizedFilename("My Complex Image (Draft)!!.PNG")).toBe(
      "my-complex-image-draft",
    );
  });

  test("falls back for empty names", () => {
    expect(getOptimizedFilename("....")).toBe("image");
  });
});
