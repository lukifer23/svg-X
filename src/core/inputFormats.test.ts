import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { traceColorDocument } from "./colorTrace";
import type { WorkerConversionOptions } from "./vectorDocument";

const root = new URL("../../tests/fixtures/formats/", import.meta.url);
const require = createRequire(import.meta.url);
const { decodeBmp } = require("../../desktop/bmp.cjs") as {
  decodeBmp: (buffer: Buffer) => {
    pixels: Buffer;
    width: number;
    height: number;
  };
};
const options: WorkerConversionOptions = {
  mode: "color",
  threshold: 128,
  turdSize: 1,
  turnPolicy: "minority",
  alphaMax: 1,
  optCurve: true,
  optTolerance: 0.3,
  blackOnWhite: true,
  invert: false,
  foregroundColor: "#000000",
  backgroundColor: "transparent",
  colorSteps: 6,
  fillStrategy: "dominant",
  strokeWidth: 1,
  maxPaths: 2_000,
};

describe("Electron input format corpus", () => {
  test("decodes and vectorizes every guaranteed packaged format", async () => {
    const files = (await readdir(root)).sort();
    expect(files).toEqual([
      "artwork.avif",
      "artwork.bmp",
      "artwork.gif",
      "artwork.jpg",
      "artwork.tiff",
      "artwork.webp",
    ]);
    for (const file of files) {
      const filePath = fileURLToPath(new URL(file, root));
      const bmp = file.endsWith(".bmp")
        ? decodeBmp(await readFile(filePath))
        : null;
      const pipeline = bmp
        ? sharp(bmp.pixels, {
            raw: { width: bmp.width, height: bmp.height, channels: 4 },
          })
        : sharp(filePath);
      const { data, info } = await pipeline
        .resize(96, 96, { fit: "inside" })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const document = traceColorDocument(
        new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
        info.width,
        info.height,
        options,
      );
      expect(document.shapes.length, file).toBeGreaterThan(0);
    }
  }, 30_000);
});
