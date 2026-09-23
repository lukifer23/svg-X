import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const { decodeToRgba } = require("../../desktop/decode.cjs") as {
  decodeToRgba: (
    source:
      | { path: string }
      | { raw: { pixels: Buffer; width: number; height: number } },
    resize: unknown,
  ) => Promise<{ pixels: ArrayBuffer; width: number; height: number }>;
};

const makeLandscape = () => {
  const width = 40;
  const height = 20;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const left = x < width / 2;
      pixels[offset] = left ? 220 : 30;
      pixels[offset + 1] = left ? 40 : 60;
      pixels[offset + 2] = left ? 40 : 220;
      pixels[offset + 3] = 255;
    }
  }
  return { pixels, width, height };
};

describe("desktop decode orientation", () => {
  test("applies EXIF orientation on the desktop path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "svgx-decode-"));
    try {
      const base = makeLandscape();
      const upright = join(dir, "upright.jpg");
      const rotated = join(dir, "rotated.jpg");
      const jpeg = { quality: 100, chromaSubsampling: "4:4:4" as const };
      await sharp(base.pixels, {
        raw: { width: base.width, height: base.height, channels: 4 },
      })
        .jpeg(jpeg)
        .toFile(upright);
      await sharp(base.pixels, {
        raw: { width: base.width, height: base.height, channels: 4 },
      })
        .withMetadata({ orientation: 6 })
        .jpeg(jpeg)
        .toFile(rotated);

      const plain = await decodeToRgba({ path: upright }, null);
      expect(plain.width).toBe(40);
      expect(plain.height).toBe(20);

      const oriented = await decodeToRgba({ path: rotated }, null);
      expect(oriented.width).toBe(20);
      expect(oriented.height).toBe(40);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  test("raw sources without EXIF pass through unchanged", async () => {
    const base = makeLandscape();
    const result = await decodeToRgba(
      { raw: { pixels: base.pixels, width: base.width, height: base.height } },
      null,
    );
    expect(result.width).toBe(40);
    expect(result.height).toBe(20);
    expect(result.pixels.byteLength).toBe(40 * 20 * 4);
  });
});
