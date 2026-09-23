import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { traceColorDocument } from "../src/core/colorTrace";
import { serializeVectorDocument } from "../src/core/serialize";
import { benchCases, benchOptions, time } from "./support";

// Total-only harness: imports just traceColorDocument, so it also runs against
// a pristine checkout (useful for stash-based before/after comparisons).
describe("total color trace", () => {
  test("total time and output hash", async () => {
    const cases = await benchCases();
    const label = process.env.BENCH_LABEL || "current";
    const reports = cases.map(({ name, rgba }) => {
      const document = traceColorDocument(
        rgba.pixels,
        rgba.width,
        rgba.height,
        benchOptions,
      );
      const hash = createHash("sha256")
        .update(serializeVectorDocument(document))
        .digest("hex");
      const totalColorMs = time(() =>
        traceColorDocument(rgba.pixels, rgba.width, rgba.height, benchOptions),
      );
      return {
        name,
        megapixels: (rgba.width * rgba.height) / 1e6,
        totalColorMs,
        outputPaths: document.diagnostics?.outputPaths ?? 0,
        outputHash: hash,
      };
    });
    const dir = fileURLToPath(new URL("../results/", import.meta.url));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      `${dir}total-${label}.json`,
      `${JSON.stringify(
        {
          label,
          generatedAt: new Date().toISOString(),
          node: process.version,
          reports,
        },
        null,
        2,
      )}\n`,
    );
    console.log(JSON.stringify(reports, null, 2));
    expect(reports.length).toBe(cases.length);
  }, 900_000);
});
