import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import path from "node:path";

interface PreviewSample {
  readyMs: number;
  jsHeapGrowthBytes: number;
  longestTaskMs: number;
}

type BenchmarkWindow = Window & {
  previewSample: Promise<PreviewSample>;
};

test("benchmarks real photo uploads through the production preview", async ({
  page,
  browser,
}) => {
  test.skip(
    process.env.SVGX_PREVIEW_BENCHMARK !== "1",
    "Run npm run bench:preview",
  );
  test.setTimeout(240_000);
  const inputs = [
    "color-bicycle.png",
    "realistic-still-life.png",
    "usda-fresh-produce.jpg",
    "usfws-rufous-hummingbird.jpg",
  ];
  const cases = inputs.flatMap((file) =>
    [false, true].flatMap((highestQuality) =>
      (file.startsWith("usda") ? [false, true] : [false]).map(
        (colorCurveFit) => ({
          file,
          highestQuality,
          colorCurveFit,
        }),
      ),
    ),
  );
  await page.goto("/");
  const browserCpus = await page.evaluate(() => navigator.hardwareConcurrency);
  const sha256 = (bytes: Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex");
  const report = [];
  const input = page.locator('input[type="file"]');
  const preview = page.getByRole("img", { name: "Converted SVG preview" });
  for (const options of cases) {
    const { file, ...settings } = options;
    const fixture = path.resolve("tests/fixtures/review", file);
    const inputSha256 = sha256(await readFile(fixture));
    await page.evaluate((value) => {
      localStorage.setItem(
        "svgx-settings-v3",
        JSON.stringify({ mode: "color", ...value }),
      );
    }, settings);
    await page.reload();
    await expect(input).toBeAttached();
    const samples = [];
    for (let iteration = 0; iteration < 4; iteration += 1) {
      if (iteration > 0)
        await page.getByRole("button", { name: "Upload New Image" }).click();
      await page.evaluate(() => {
        (window as BenchmarkWindow).previewSample = new Promise(
          (resolve, reject) => {
            const heap = () =>
              (
                performance as Performance & {
                  memory?: { usedJSHeapSize: number };
                }
              ).memory?.usedJSHeapSize ?? 0;
            document.addEventListener(
              "change",
              () => {
                const start = performance.now();
                const beforeHeap = heap();
                let maximumHeap = beforeHeap;
                const sampleHeap = () => {
                  maximumHeap = Math.max(maximumHeap, heap());
                };
                const poll = window.setInterval(sampleHeap, 16);
                let longestTaskMs = 0;
                const countTasks = (entries: PerformanceEntry[]) => {
                  for (const entry of entries)
                    if (entry.startTime >= start)
                      longestTaskMs = Math.max(longestTaskMs, entry.duration);
                };
                const tasks = new PerformanceObserver((list) =>
                  countTasks(list.getEntries()),
                );
                tasks.observe({ type: "longtask" });
                const stop = () => {
                  countTasks(tasks.takeRecords());
                  tasks.disconnect();
                  clearInterval(poll);
                };
                const observer = new MutationObserver(() => {
                  const image = document.querySelector<HTMLImageElement>(
                    'img[alt="Converted SVG preview"][src]',
                  );
                  if (!image) return;
                  observer.disconnect();
                  void image.decode().then(
                    () => {
                      requestAnimationFrame(() =>
                        requestAnimationFrame(() => {
                          sampleHeap();
                          stop();
                          resolve({
                            readyMs: performance.now() - start,
                            jsHeapGrowthBytes: maximumHeap - beforeHeap,
                            longestTaskMs,
                          });
                        }),
                      );
                    },
                    (error: unknown) => {
                      stop();
                      reject(error);
                    },
                  );
                });
                observer.observe(document.body, {
                  childList: true,
                  subtree: true,
                  attributes: true,
                  attributeFilter: ["src"],
                });
              },
              { capture: true, once: true },
            );
          },
        );
      });
      await input.setInputFiles(fixture);
      await expect(preview).toBeVisible();
      const latency = await page.evaluate(
        () => (window as BenchmarkWindow).previewSample,
      );
      await page.getByRole("button", { name: "View Processing Logs" }).click();
      const logs = await page
        .getByRole("dialog", { name: "Processing Logs" })
        .innerText();
      const metrics = Object.fromEntries(
        Array.from(
          logs.matchAll(
            /(decode|quantize|vectorize|serialize|optimize)=([0-9]+)ms/g,
          ),
          ([, name, value]) => [name, Number(value)],
        ),
      );
      const total = logs.match(/Completed in ([0-9]+)ms/);
      expect(Object.keys(metrics).sort()).toEqual([
        "decode",
        "optimize",
        "quantize",
        "serialize",
        "vectorize",
      ]);
      expect(total).not.toBeNull();
      expect(latency.readyMs).toBeGreaterThan(0);
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("dialog", { name: "Processing Logs" }),
      ).toBeHidden();
      samples.push({
        ...latency,
        ...metrics,
        conversionMs: Number(total?.[1]),
      });
    }
    const fidelity = await preview.evaluate(async (node: HTMLImageElement) => {
      const svg = await (await fetch(node.currentSrc)).arrayBuffer();
      const canvas = document.createElement("canvas");
      canvas.width = node.naturalWidth;
      canvas.height = node.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D is unavailable");
      ctx.drawImage(node, 0, 0);
      const raster = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const hash = async (bytes: ArrayBuffer) =>
        Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
          (value) => value.toString(16).padStart(2, "0"),
        ).join("");
      return {
        width: canvas.width,
        height: canvas.height,
        svgBytes: svg.byteLength,
        svgSha256: await hash(svg),
        rasterSha256: await hash(raster.buffer),
      };
    });
    const warm = samples.slice(1);
    const median = Object.fromEntries(
      Object.keys(warm[0]).map((key) => [
        key,
        warm
          .map((sample) => sample[key as keyof typeof sample])
          .sort((a, b) => a - b)[1],
      ]),
    );
    report.push({
      ...options,
      inputSha256,
      fidelity,
      first: samples[0],
      warm,
      median,
    });
  }
  const label = process.env.BENCH_LABEL ?? "local";
  const baseline = process.env.SVGX_PREVIEW_BASELINE;
  if (baseline) {
    const compare = (entries: typeof report) =>
      entries.map(
        ({ file, highestQuality, colorCurveFit, inputSha256, fidelity }) => ({
          file,
          highestQuality,
          colorCurveFit,
          inputSha256,
          fidelity,
        }),
      );
    const expected: { report: typeof report } = JSON.parse(
      await readFile(path.join("results", baseline), "utf8"),
    );
    expect(compare(report)).toEqual(compare(expected.report));
  }
  await writeFile(
    path.join("results", `preview-latency-${label}.json`),
    `${JSON.stringify({ label, platform: process.platform, cpu: cpus()[0]?.model.trim(), node: process.version, chromium: browser.version(), browserCpus, report }, null, 2)}\n`,
  );
});
