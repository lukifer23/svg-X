import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const { normalizeOutputBase, writeUniqueOutput } =
  require("../../desktop/files.cjs") as {
    normalizeOutputBase: (name: string) => string;
    writeUniqueOutput: (
      root: string,
      baseName: string,
      extension: string,
      content: string,
    ) => Promise<{ success: boolean; name: string }>;
  };

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("atomic output reservation", () => {
  test("normalizes hostile names", () => {
    expect(normalizeOutputBase("../My Artwork!!.PNG")).toBe("my-artwork-png");
  });

  test("never overwrites existing or concurrently reserved output", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "svg-x-output-"));
    directories.push(root);
    await writeFile(path.join(root, "art.svg"), "original", "utf8");

    const results = await Promise.all([
      writeUniqueOutput(root, "art", "svg", "first"),
      writeUniqueOutput(root, "art", "svg", "second"),
    ]);

    expect(results.map((result) => result.name).sort()).toEqual([
      "art-1.svg",
      "art-2.svg",
    ]);
    expect(await readFile(path.join(root, "art.svg"), "utf8")).toBe("original");
    expect(
      new Set(
        await Promise.all(
          results.map((result) =>
            readFile(path.join(root, result.name), "utf8"),
          ),
        ),
      ),
    ).toEqual(new Set(["first", "second"]));
  });
});
