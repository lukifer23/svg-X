import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { expect, test } from "vitest";

const run = promisify(execFile);
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="40"><path d="M5 21 Q20 3 40 22 M6 26 Q21 9 41 27" fill="none" stroke="black" stroke-width="2"/></svg>';
const item = { svg: "original.svg", group: "loop-artwork", license: "CC0-1.0" };
const build = (manifest: string, output: string) =>
  run(process.execPath, [
    "scripts/build-training-dataset.mjs",
    manifest,
    output,
  ]);

test("exports repeatable source-aligned training pairs using the real CLI", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "svgx-dataset-"));
  try {
    const manifest = path.join(root, "source.json");
    await writeFile(path.join(root, item.svg), svg);
    await writeFile(
      manifest,
      JSON.stringify({
        seed: "regression-v1",
        variants: 2,
        maxDimension: 48,
        items: [item],
      }),
    );
    const left = path.join(root, "left");
    const right = path.join(root, "right");
    await build(manifest, left);
    await build(manifest, right);
    const index = await readFile(path.join(left, "manifest.jsonl"), "utf8");
    expect(await readFile(path.join(right, "manifest.jsonl"), "utf8")).toBe(
      index,
    );
    const records = index
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      labelKind: "source-svg",
      schemaVersion: 1,
      group: item.group,
      license: item.license,
      width: 48,
      height: 40,
    });
    expect(records[0].split).toBe(records[1].split);
    expect(records[0].target).toBe(records[1].target);
    for (const { input, target, reference } of records) {
      const data = await readFile(path.join(left, input));
      expect(data.equals(await readFile(path.join(right, input)))).toBe(true);
      expect(data.equals(await readFile(path.join(left, target)))).toBe(false);
      expect(await sharp(data).metadata()).toMatchObject({
        width: 48,
        height: 40,
      });
      expect(await readFile(path.join(left, reference), "utf8")).toBe(svg);
    }
    await expect(build(manifest, left)).rejects.toThrow(/EEXIST/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects external SVG references and prevents exact raster split leakage", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "svgx-dataset-invalid-"));
  try {
    const manifest = path.join(root, "source.json");
    await writeFile(path.join(root, item.svg), svg);
    await writeFile(
      path.join(root, "duplicate.svg"),
      svg.replace("<path", "<!-- duplicated geometry --><path"),
    );
    await writeFile(
      manifest,
      JSON.stringify({
        items: [item, { ...item, group: "unrelated", svg: "duplicate.svg" }],
      }),
    );
    const duplicate = path.join(root, "duplicate");
    await expect(build(manifest, duplicate)).rejects.toThrow(
      /Identical clean raster assigned/,
    );
    await expect(
      readFile(path.join(duplicate, "manifest.jsonl")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await writeFile(
      path.join(root, item.svg),
      svg.replace("</svg>", '<use href="other.svg#path"/></svg>'),
    );
    await writeFile(manifest, JSON.stringify({ items: [item] }));
    await expect(build(manifest, path.join(root, "external"))).rejects.toThrow(
      /Unsupported SVG reference/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
