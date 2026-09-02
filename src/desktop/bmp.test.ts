import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const { decodeBmp } = require("../../desktop/bmp.cjs") as {
  decodeBmp: (
    buffer: Buffer,
    maximumPixels?: number,
  ) => {
    pixels: Buffer;
    width: number;
    height: number;
  };
};

describe("BMP decoder", () => {
  test("decodes the real 24-bit fixture to opaque RGBA", async () => {
    const buffer = await readFile(
      fileURLToPath(
        new URL("../../tests/fixtures/formats/artwork.bmp", import.meta.url),
      ),
    );
    const result = decodeBmp(buffer);
    expect(result.width).toBe(192);
    expect(result.height).toBe(192);
    expect(result.pixels.length).toBe(192 * 192 * 4);
    expect(
      result.pixels
        .filter((_, index) => index % 4 === 3)
        .every((alpha) => alpha === 255),
    ).toBe(true);
  });

  test("rejects malformed and oversized inputs", () => {
    expect(() => decodeBmp(Buffer.from("not a bitmap"))).toThrow("Invalid BMP");
    const header = Buffer.alloc(54);
    header.write("BM");
    header.writeUInt32LE(40, 14);
    header.writeInt32LE(20, 18);
    header.writeInt32LE(20, 22);
    header.writeUInt16LE(1, 26);
    header.writeUInt16LE(24, 28);
    expect(() => decodeBmp(header, 10)).toThrow("pixel limit");
  });
});
