import { expect, test } from "@playwright/test";

test("eight-image production worker batch improves throughput without runaway memory", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Chromium provides stable heap telemetry",
  );
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "hardwareConcurrency", {
      configurable: true,
      get: () => 4,
    });
  });
  await page.goto("/", { waitUntil: "networkidle" });
  const runBenchmark = () =>
    page.evaluate(async () => {
      const module = await import("/src/utils/imageProcessor.ts");
      const size = 640;
      const createInput = () => {
        const pixels = new Uint8ClampedArray(size * size * 4);
        const colors = [
          [18, 72, 210],
          [230, 45, 60],
          [245, 198, 28],
          [18, 158, 105],
        ];
        for (let y = 0; y < size; y += 1) {
          for (let x = 0; x < size; x += 1) {
            const offset = (y * size + x) * 4;
            const color = colors[(Math.floor(x / 32) + Math.floor(y / 32)) % 4];
            pixels.set([...color, 255], offset);
          }
        }
        return { pixels: pixels.buffer, width: size, height: size };
      };
      const params = {
        ...module.DEFAULT_PARAMS,
        colorMode: true,
        colorSteps: 4,
        maxPaths: 2_000,
        svgoOptimize: false,
      };
      const convert = () =>
        module.processImageBatch(createInput(), params, undefined);
      await convert();
      const beforeHeap =
        (performance as Performance & { memory?: { usedJSHeapSize: number } })
          .memory?.usedJSHeapSize ?? 0;
      const sequentialSamples: number[] = [];
      const concurrentSamples: number[] = [];
      for (let sample = 0; sample < 3; sample += 1) {
        const sequentialStart = performance.now();
        for (let index = 0; index < 8; index += 1) await convert();
        sequentialSamples.push(performance.now() - sequentialStart);

        const concurrentStart = performance.now();
        await Promise.all(Array.from({ length: 8 }, () => convert()));
        concurrentSamples.push(performance.now() - concurrentStart);
      }
      const median = (samples: number[]) =>
        [...samples].sort((left, right) => left - right)[
          Math.floor(samples.length / 2)
        ];
      const sequentialMs = median(sequentialSamples);
      const concurrentMs = median(concurrentSamples);
      const afterHeap =
        (performance as Performance & { memory?: { usedJSHeapSize: number } })
          .memory?.usedJSHeapSize ?? 0;
      return {
        hardwareConcurrency: navigator.hardwareConcurrency,
        sequentialMs,
        concurrentMs,
        sequentialSamples,
        concurrentSamples,
        heapGrowth: Math.max(0, afterHeap - beforeHeap),
      };
    });
  const result = await runBenchmark().catch(async (error: unknown) => {
    if (
      !(error instanceof Error) ||
      !error.message.includes("Execution context was destroyed")
    )
      throw error;
    await page.waitForLoadState("networkidle");
    return runBenchmark();
  });

  console.log(
    `batch benchmark: ${result.sequentialMs.toFixed(1)}ms sequential, ${result.concurrentMs.toFixed(1)}ms pooled, ${(result.sequentialMs / result.concurrentMs).toFixed(2)}x throughput, ${(result.heapGrowth / 1024 / 1024).toFixed(1)} MiB heap growth on ${result.hardwareConcurrency} logical CPUs`,
  );
  expect(result.heapGrowth).toBeLessThan(256 * 1024 * 1024);
  if (result.hardwareConcurrency >= 3)
    expect(result.sequentialMs / result.concurrentMs).toBeGreaterThanOrEqual(
      1.5,
    );
});
