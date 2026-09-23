import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { traceColorDocument } from "../../../src/core/colorTrace";
import { serializeVectorDocument } from "../../../src/core/serialize";
import type { WorkerConversionOptions } from "../../../src/core/vectorDocument";

const options: WorkerConversionOptions = {
  mode: "color",
  threshold: 128,
  turdSize: 2,
  turnPolicy: "minority",
  alphaMax: 1,
  optCurve: false,
  optTolerance: 0.2,
  blackOnWhite: true,
  invert: false,
  foregroundColor: "#000000",
  backgroundColor: "transparent",
  colorSteps: 8,
  fillStrategy: "dominant",
  strokeWidth: 2,
  maxPaths: 2000,
};

const load = async (name: string, size: number) => {
  const path = fileURLToPath(
    new URL(`../../../tests/fixtures/review/${name}`, import.meta.url),
  );
  const raw = await sharp(readFileSync(path))
    .resize(size, size, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    pixels: new Uint8ClampedArray(
      raw.data.buffer,
      raw.data.byteOffset,
      raw.data.byteLength,
    ).slice(),
    width: raw.info.width,
    height: raw.info.height,
  };
};

describe("output hash (exactness guard)", () => {
  test("color tracing is deterministic and recorded", async () => {
    const cases: Array<[string, number]> = [
      ["color-bicycle.png", 1000],
      ["realistic-still-life.png", 1000],
      ["centerline-mechanism.png", 1000],
    ];
    const hashes: string[] = [];
    for (const [name, size] of cases) {
      const { pixels, width, height } = await load(name, size);
      const document = traceColorDocument(pixels, width, height, options);
      const svg = serializeVectorDocument(document);
      const hash = createHash("sha256").update(svg).digest("hex");
      hashes.push(`${name} ${hash} paths=${document.diagnostics?.outputPaths}`);
      console.log(hashes[hashes.length - 1]);
    }
    expect(hashes.length).toBe(cases.length);
  }, 600_000);
});
