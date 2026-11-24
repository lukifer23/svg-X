import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import qualification from "../../tests/fixtures/qualification/references.json";
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

test("restoration pilot rejects a qualification document before starting training", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "svgx-reserved-scan-"));
  try {
    const reviewed = path.join(directory, "reviewed.json");
    const source = new URL(qualification[0].source);
    source.hostname = source.hostname.replace(/^www\./, "");
    source.searchParams.set("sp", "1");
    await writeFile(
      reviewed,
      JSON.stringify({ scans: [{ source: source.href }] }),
    );
    await expect(
      run(process.execPath, [
        "scripts/run-restoration-pilot.mjs",
        path.join(directory, "run"),
        "cpu",
        reviewed,
      ]),
    ).rejects.toThrow(/Reserved archival qualification source/);
    const scan = await readFile(
      path.resolve(
        "tests/fixtures/qualification",
        `${qualification[0].id}.jpg`,
      ),
    );
    await writeFile(
      reviewed,
      JSON.stringify({
        scans: [
          {
            source: "https://example.org/renamed-scan",
            sourceSha256: createHash("sha256").update(scan).digest("hex"),
          },
        ],
      }),
    );
    await expect(
      run(process.execPath, [
        "scripts/run-restoration-pilot.mjs",
        path.join(directory, "run"),
        "cpu",
        reviewed,
      ]),
    ).rejects.toThrow(/Reserved archival qualification source/);
    expect(await readdir(directory)).toEqual(["reviewed.json"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

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
      schemaVersion: 2,
      group: item.group,
      license: item.license,
      width: 48,
      height: 40,
    });
    expect(records[0].split).toBe(records[1].split);
    expect(records[0].target).toBe(records[1].target);
    expect(records[0].inputPixelSha256).toMatch(/^[a-f0-9]{64}$/);
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
}, 15_000);

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

test("audits a published dataset and flags near-duplicate targets across splits", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "svgx-dataset-audit-"));
  const audit = (output: string) =>
    run(process.execPath, ["scripts/audit-training-dataset.mjs", output]);
  try {
    const curated = path.join(root, "curated");
    const corpus = "examples/training-data/corpus";
    await build(path.join(corpus, "manifest.json"), curated);
    expect(JSON.parse((await audit(curated)).stdout)).toMatchObject({
      rows: 128,
      legacyRows: 0,
      uniqueTargets: 32,
      bySplit: { train: 23, validation: 4, test: 5 },
      flagged: 0,
    });
    const notice = "lucide-LICENSE.txt";
    expect(await readFile(path.join(curated, "notices", notice), "utf8")).toBe(
      await readFile(path.join(corpus, "lucide", notice), "utf8"),
    );
    const index = await readFile(path.join(curated, "manifest.jsonl"), "utf8");
    const first = JSON.parse(index.split("\n")[0]);
    for (const [relative, replacement, error] of [
      [
        first.input,
        await readFile(path.join(curated, first.target)),
        /Raster pixels do not match manifest/,
      ],
      [
        first.target,
        await readFile(path.join(curated, first.input)),
        /Raster pixels do not match manifest/,
      ],
      [first.reference, Buffer.from(svg), /Reference does not match manifest/],
    ] as const) {
      const file = path.join(curated, relative);
      const original = await readFile(file);
      await writeFile(file, replacement);
      await expect(audit(curated)).rejects.toThrow(error);
      await writeFile(file, original);
    }
    const version1 = index
      .trimEnd()
      .split("\n")
      .map((line) => {
        const record = JSON.parse(line);
        delete record.inputPixelSha256;
        return JSON.stringify({ ...record, schemaVersion: 1 });
      });
    await writeFile(
      path.join(curated, "manifest.jsonl"),
      version1.join("\n") + "\n",
    );
    expect(JSON.parse((await audit(curated)).stdout)).toMatchObject({
      rows: 128,
      legacyRows: 128,
      flagged: 0,
    });

    const manifest = path.join(root, "source.json");
    await Promise.all([
      writeFile(path.join(root, "train.svg"), svg),
      writeFile(
        path.join(root, "validation.svg"),
        svg.replace('stroke="black"', 'stroke="#333333"'),
      ),
      writeFile(
        path.join(root, "test.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="40"><rect x="8" y="8" width="32" height="24"/></svg>',
      ),
      writeFile(
        manifest,
        JSON.stringify({
          variants: 1,
          items: [
            { ...item, svg: "train.svg", group: "maki/airport" },
            { ...item, svg: "validation.svg", group: "lucide/bug" },
            { ...item, svg: "test.svg", group: "lucide/orbit" },
          ],
        }),
      ),
    ]);
    const near = path.join(root, "near");
    await build(manifest, near);
    await expect(audit(near)).rejects.toThrow(/Review cross-split silhouettes/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);
