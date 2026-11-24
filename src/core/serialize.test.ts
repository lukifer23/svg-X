import sharp from "sharp";
import { expect, test } from "vitest";
import { serializeVectorDocument } from "./serialize";
import type { VectorDocument } from "./vectorDocument";

test("compact SVG preserves compound paths, paint and rounded cubic geometry", async () => {
  const document: VectorDocument = {
    version: 1,
    mode: "color",
    width: 512,
    height: 96,
    shapes: [
      {
        id: "ink",
        fill: "rgb(34,68,102)",
        stroke: "#654321",
        strokeWidth: 0.75,
        opacity: 0.75,
        fillRule: "evenodd",
        subpaths: [
          {
            closed: true,
            commands: [
              { type: "M", x: -0.0001, y: 0.1251 },
              {
                type: "C",
                x1: -0.125,
                y1: 0.5,
                x2: 12,
                y2: -0.25,
                x: 240,
                y: 2,
              },
              { type: "C", x1: 270, y1: 2, x2: 350, y2: 10, x: 402, y: 24 },
              { type: "L", x: 406, y: 24 },
              { type: "L", x: 406, y: 28 },
              { type: "L", x: 400, y: 36 },
              { type: "L", x: 401, y: 41 },
              { type: "L", x: 0, y: 90 },
              { type: "Z" },
            ],
          },
          {
            closed: true,
            commands: [
              { type: "M", x: 20.125, y: 20 },
              { type: "L", x: 24.125, y: 20 },
              { type: "L", x: 24.125, y: 24 },
              { type: "L", x: 20.125, y: 24 },
              { type: "Z" },
            ],
          },
          {
            closed: true,
            commands: [
              { type: "M", x: 400, y: 55 },
              {
                type: "C",
                x1: 388.041,
                y1: 60,
                x2: 399,
                y2: 66,
                x: 402,
                y: 55,
              },
              { type: "Z" },
            ],
          },
        ],
      },
    ],
  };
  const plain = serializeVectorDocument(document);
  const compact = serializeVectorDocument(document, { compact: true });
  expect(compact.length).toBeLessThan(plain.length);
  expect(compact).toContain('fill="#246"');
  expect(compact).toContain("M0 .125C-.125 .5 12-.25 240 2c30 0 110 8 162 22");
  expect(compact).toContain("h4v4l-6 8 1 5");
  expect(compact).toContain("ZM20.125 20H24.125V24H20.125Z");
  // The relative x1 would reconstruct to another float32 value.
  expect(compact).toContain("M400 55C388.041 60 399 66 402 55Z");
  const rasterize = (svg: string) =>
    sharp(Buffer.from(svg), { density: 144 }).raw().toBuffer();
  const [reference, rendered] = await Promise.all([
    rasterize(plain),
    rasterize(compact),
  ]);
  expect(rendered.equals(reference)).toBe(true);
});

test("compact SVG preserves rounded decimal text on both sides of the fast range", () => {
  const document: VectorDocument = {
    version: 1,
    mode: "color",
    width: 1,
    height: 1,
    shapes: [
      {
        id: "decimal-test",
        fill: "#000",
        stroke: "none",
        strokeWidth: 0,
        opacity: 1,
        fillRule: "evenodd",
        subpaths: [
          {
            closed: false,
            commands: [
              { type: "M", x: 0.001, y: -0.01 },
              { type: "M", x: 20.1, y: -20.01 },
              { type: "M", x: 2097151.999, y: -2097152.001 },
            ],
          },
        ],
      },
    ],
  };
  expect(serializeVectorDocument(document, { compact: true })).toContain(
    'd="M.001-.01M20.1-20.01M2097151.999-2097152.001"',
  );
});
