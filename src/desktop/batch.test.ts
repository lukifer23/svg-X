import { channel } from "node:diagnostics_channel";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const { createBatchRun } = require("../../desktop/batch.cjs") as {
  createBatchRun: (
    inputRoot: string,
    outputRoot: string,
    format?: string,
  ) => {
    read: (input: { fileId: string }) => Promise<{
      pixels: ArrayBuffer;
      width: number;
      height: number;
    }>;
    write: (input: {
      baseName: string;
      content: string;
    }) => Promise<{ success: boolean; name: string }>;
    cancel: () => void;
    finish: () => Promise<void>;
  };
};
const scans = fileURLToPath(
  new URL("../../tests/fixtures/qualification/", import.meta.url),
);
const input = { fileId: "photophone.jpg" };
const output = {
  baseName: "art",
  content: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>',
};

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "svg-x-batch-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("rejects unsupported formats before touching the output directory", async () => {
  expect(() => createBatchRun(scans, root, "../other")).toThrow(
    "Unsupported export format",
  );
  expect(await readdir(root)).toEqual([]);
});

test("finish drains a submitted Sharp decode and rejects later work", async () => {
  const run = createBatchRun(scans, root);
  const checkpoint = channel("svg-x:batch:decode-submitted");
  const events: string[] = [];
  let drained: Promise<void> | undefined;
  const finishDuringDecode = () => {
    events.push("decode submitted");
    drained = run.finish().then(() => {
      events.push("drained");
    });
  };
  checkpoint.subscribe(finishDuringDecode);
  try {
    await expect(
      run.read(input).catch((error: unknown) => {
        events.push("read rejected");
        throw error;
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(drained).toBeDefined();
    await drained;
    expect(events).toEqual(["decode submitted", "read rejected", "drained"]);
    await expect(run.write(output)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(await readdir(root)).toEqual([]);
  } finally {
    checkpoint.unsubscribe(finishDuringDecode);
    await run.finish();
  }

  const resumed = createBatchRun(scans, root);
  const decoded = await resumed.read(input);
  expect(Math.max(decoded.width, decoded.height)).toBe(1000);
  expect(decoded.pixels.byteLength).toBe(decoded.width * decoded.height * 4);
  await resumed.finish();
});

test("cancel after staging blocks publication and preserves the existing SVG", async () => {
  const run = createBatchRun(scans, root);
  const existing = path.join(root, "art.svg");
  await writeFile(existing, "original");
  const checkpoint = channel("svg-x:batch:output-staged");
  let staged: string | undefined;
  const cancelStaged = (event: unknown) => {
    const { staged: stagedPath } = event as { staged: string };
    staged = readFileSync(stagedPath, "utf8");
    run.cancel();
  };
  checkpoint.subscribe(cancelStaged);
  try {
    await expect(run.write(output)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(staged).toBe(output.content);
    expect(await readdir(root)).toEqual(["art.svg"]);
    expect(await readFile(existing, "utf8")).toBe("original");
  } finally {
    checkpoint.unsubscribe(cancelStaged);
    await run.finish();
  }
});

test("cancel during exclusive publication retains the committed SVG and drains cleanup", async () => {
  const run = createBatchRun(scans, root);
  const existing = path.join(root, "art.svg");
  await writeFile(existing, "original");
  const checkpoint = channel("svg-x:batch:publication-submitted");
  let drained: Promise<void> | undefined;
  const finishDuringPublication = (event: unknown) => {
    const { target } = event as { target: string };
    if (path.basename(target) === "art-1.svg") drained = run.finish();
  };
  checkpoint.subscribe(finishDuringPublication);
  try {
    const job = run.write(output);
    await expect(job).resolves.toEqual({ success: true, name: "art-1.svg" });
    expect(drained).toBeDefined();
    await drained;
    await expect(run.write(output)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect((await readdir(root)).sort()).toEqual(["art-1.svg", "art.svg"]);
    expect(await readFile(existing, "utf8")).toBe("original");
    expect(await readFile(path.join(root, "art-1.svg"), "utf8")).toBe(
      output.content,
    );
  } finally {
    checkpoint.unsubscribe(finishDuringPublication);
    await run.finish();
  }
});
