import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { traceBlackAndWhite } from "./bwTrace";
import { traceCenterlines } from "./centerline";
import { traceColorDocument } from "./colorTrace";
import { serializeVectorDocument } from "./serialize";
import type {
  ConversionMode,
  VectorDocument,
  WorkerConversionOptions,
} from "./vectorDocument";

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

const checkSharedSegments = (document: VectorDocument) => {
  const { width, height } = document;
  const edges = new Map<string, number>();
  let cubics = 0;
  for (const shape of document.shapes) {
    for (const { commands } of shape.subpaths) {
      let x = 0;
      let y = 0;
      for (const command of commands) {
        if (command.type === "Z") continue;
        const end = [command.x, command.y];
        if (command.type !== "M") {
          const onFrame =
            command.type === "L" &&
            ((x === command.x && (x === 0 || x === width)) ||
              (y === command.y && (y === 0 || y === height)));
          if (!onFrame) {
            const start = [x, y];
            const controls =
              command.type === "C"
                ? [
                    [command.x1, command.y1],
                    [command.x2, command.y2],
                  ]
                : [];
            if (command.type === "C") cubics += 1;
            const forward = JSON.stringify([start, ...controls, end]);
            const backward = JSON.stringify([
              end,
              ...controls.reverse(),
              start,
            ]);
            const key = forward < backward ? forward : backward;
            edges.set(
              key,
              (edges.get(key) ?? 0) + (forward < backward ? 1 : -1),
            );
          }
        }
        [x, y] = end;
      }
    }
  }
  expect(cubics).toBeGreaterThan(0);
  expect([...edges.values()].filter((count) => count !== 0)).toHaveLength(0);
};

describe("generated visual review corpus", () => {
  test.each(["color-bicycle.png", "realistic-still-life.png"])(
    "uses exact reversed cubic geometry on both sides of every internal edge in %s",
    async (name) => {
      const image = await decode(name, 192);
      // A white matte is the production default and makes the outer frame
      // the only boundary with a single painted side.
      for (let i = 0; i < image.pixels.length; i += 4) {
        const alpha = image.pixels[i + 3] / 255;
        for (let channel = 0; channel < 3; channel += 1)
          image.pixels[i + channel] = Math.round(
            image.pixels[i + channel] * alpha + 255 * (1 - alpha),
          );
        image.pixels[i + 3] = 255;
      }
      const document = traceColorDocument(
        image.pixels,
        image.width,
        image.height,
        options("color"),
      );
      checkSharedSegments(document);
    },
  );
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
