import { describe, expect, test } from "vitest";
import {
  simplifyForNetworkClients,
  DEFAULT_PARAMS,
  getOptimizedFilename,
} from "./imageProcessor";

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
