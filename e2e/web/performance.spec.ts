import { expect, test } from "@playwright/test";

test("eight-image production worker batch improves throughput without runaway memory", async ({
  page,
  browserName,
}) => {
  const configuredFloor = process.env.SVGX_MIN_BATCH_SPEEDUP;
  const minimumSpeedup = configuredFloor ? Number(configuredFloor) : 1.5;
  if (!Number.isFinite(minimumSpeedup) || minimumSpeedup <= 1)
    throw new Error(
      `SVGX_MIN_BATCH_SPEEDUP must be a finite number greater than 1, received ${configuredFloor}`,
    );
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
  // Vite can perform a one-time full reload while discovering dependencies for
  // this test-only dynamic import. Finish that optimization before timing the
  // worker pool so a dev-server navigation cannot invalidate the benchmark.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await page.evaluate(async () => {
        await import("/src/utils/imageProcessor.ts");
      });
      break;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes("Execution context was destroyed") ||
        attempt === 4
      )
        throw error;
      await page.waitForLoadState("networkidle");
    }
  }
  const runBenchmark = () =>
    page.evaluate(async () => {
      const module = await import("/src/utils/imageProcessor.ts");
      // Keep the fixture above MIN_PARALLEL_PIXELS while bounding this gate on
      // shared CI runners. The benchmark still performs a real eight-image
      // sequential batch and a real eight-image pooled batch three times, then
      // compares medians so a single scheduler fluctuation cannot pass or fail
      // the acceptance gate.
      const size = 512;
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
        mode: "color" as const,
        colorSteps: 4,
        maxPaths: 2_000,
        svgoOptimize: false,
      };
      const fixture = createInput();
      const prepare = () => ({ ...fixture, pixels: fixture.pixels.slice(0) });
      const convert = (input: ReturnType<typeof prepare>) =>
        module.processImageBatch(input, params, undefined);
      await convert(prepare());
      const beforeHeap =
        (performance as Performance & { memory?: { usedJSHeapSize: number } })
          .memory?.usedJSHeapSize ?? 0;
      let peakHeap = beforeHeap;
      const heapSampler = window.setInterval(() => {
        const current = (
          performance as Performance & { memory?: { usedJSHeapSize: number } }
        ).memory?.usedJSHeapSize;
        if (current) peakHeap = Math.max(peakHeap, current);
      }, 25);
      const sequentialSamples: number[] = [];
      const concurrentSamples: number[] = [];
      for (let sample = 0; sample < 3; sample += 1) {
        // Prepare inputs before timing. Fixture construction runs on the
        // renderer and otherwise competes with worker scheduling.
        const sequentialInputs = Array.from({ length: 8 }, prepare);
        const sequentialStart = performance.now();
        for (const input of sequentialInputs) await convert(input);
        sequentialSamples.push(performance.now() - sequentialStart);

        const concurrentInputs = Array.from({ length: 8 }, prepare);
        const concurrentStart = performance.now();
        await Promise.all(concurrentInputs.map(convert));
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
      window.clearInterval(heapSampler);
      return {
        hardwareConcurrency: navigator.hardwareConcurrency,
        sequentialMs,
        concurrentMs,
        sequentialSamples,
        concurrentSamples,
        heapGrowth: Math.max(0, afterHeap - beforeHeap),
        peakHeapGrowth: Math.max(0, peakHeap - beforeHeap),
      };
    });
  const result = await runBenchmark();

  console.log(
    `batch benchmark: ${result.sequentialMs.toFixed(1)}ms sequential, ${result.concurrentMs.toFixed(1)}ms pooled, ${(result.sequentialMs / result.concurrentMs).toFixed(2)}x throughput against ${minimumSpeedup.toFixed(2)}x floor, ${(result.peakHeapGrowth / 1024 / 1024).toFixed(1)} MiB peak / ${(result.heapGrowth / 1024 / 1024).toFixed(1)} MiB settled heap growth on ${result.hardwareConcurrency} logical CPUs`,
  );
  expect(result.peakHeapGrowth).toBeLessThan(256 * 1024 * 1024);
  expect(result.heapGrowth).toBeLessThan(256 * 1024 * 1024);
  if (result.hardwareConcurrency >= 3)
    expect(result.sequentialMs / result.concurrentMs).toBeGreaterThanOrEqual(
      minimumSpeedup,
    );
});
