import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { traceBlackAndWhite } from "./bwTrace";
import { traceCenterlines } from "./centerline";
import { traceColorDocument } from "./colorTrace";
import { serializeVectorDocument } from "./serialize";
import type { ConversionMode, WorkerConversionOptions } from "./vectorDocument";

const fixture = (name: string): URL =>
  new URL(`../../tests/fixtures/review/${name}`, import.meta.url);

const decode = async (name: string, size = 160) => {
  const buffer = await readFile(fixture(name));
  const { data, info } = await sharp(buffer)
    .resize(size, size, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    pixels: new Uint8ClampedArray(
      data.buffer,
      data.byteOffset,
      data.byteLength,
    ),
    width: info.width,
    height: info.height,
  };
};

const options = (mode: ConversionMode): WorkerConversionOptions => ({
  mode,
  threshold: 160,
  turdSize: 2,
  turnPolicy: "minority",
  alphaMax: 1,
  optCurve: true,
  optTolerance: 0.25,
  blackOnWhite: true,
  invert: false,
  foregroundColor: "#111111",
  backgroundColor: "transparent",
  colorSteps: 6,
  fillStrategy: "dominant",
  strokeWidth: 1.5,
  maxPaths: 2_000,
});

describe("generated visual review corpus", () => {
  test("traces the flat-color artwork as multiple closed color regions", async () => {
    const image = await decode("color-bicycle.png");
    const document = traceColorDocument(
      image.pixels,
      image.width,
      image.height,
      options("color"),
    );
    expect(document.shapes.length).toBeGreaterThanOrEqual(4);
    expect(document.shapes.every((shape) => shape.fillRule === "evenodd")).toBe(
      true,
    );
    expect(serializeVectorDocument(document)).toContain("<path ");
  });

  test("walks real line-art into open centerline geometry", async () => {
    const image = await decode("centerline-mechanism.png");
    const document = traceCenterlines(
      image.pixels,
      image.width,
      image.height,
      options("centerline"),
    );
    const foreground = document.shapes.find(
      (shape) => shape.id === "centerline-foreground",
    );
    expect(foreground?.subpaths.length).toBeGreaterThan(5);
    expect(foreground?.subpaths.some((path) => !path.closed)).toBe(true);
  });

  test("keeps the photographic stress fixture convertible in both color and B&W", async () => {
    const image = await decode("realistic-still-life.png", 96);
    const color = traceColorDocument(
      image.pixels,
      image.width,
      image.height,
      options("color"),
    );
    const blackAndWhite = traceBlackAndWhite(
      image.pixels,
      image.width,
      image.height,
      options("bw"),
    );
    expect(color.shapes.length).toBeGreaterThanOrEqual(3);
    expect(blackAndWhite.shapes.length).toBeGreaterThan(0);
  });
});
