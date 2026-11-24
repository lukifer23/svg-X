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
      // sequential batch and a real eight-image pooled batch, then compares
      // medians so a single scheduler fluctuation cannot decide the gate.
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
      const measureBatch = async (pooled: boolean, expectedOutput?: string) => {
        // Prepare inputs before timing so fixture allocation does not compete
        // with worker scheduling.
        const inputs = Array.from({ length: 8 }, prepare);
        const start = performance.now();
        if (pooled) {
          const output = await Promise.all(inputs.map(convert));
          const elapsed = performance.now() - start;
          if (
            expectedOutput !== undefined &&
            output.some((svg) => svg !== expectedOutput)
          ) {
            throw new Error("Pooled Color output differs from serial output");
          }
          return elapsed;
        }
        for (const input of inputs) await convert(input);
        return performance.now() - start;
      };
      const serialOutput = await convert(prepare());
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
      // Warm both schedules, including every worker used by the pooled run.
      // Keep measuring heap across warm-up so worker startup is covered.
      await measureBatch(false);
      await measureBatch(true, serialOutput);
      const sequentialSamples: number[] = [];
      const concurrentSamples: number[] = [];
      for (let sample = 0; sample < 6; sample += 1) {
        // Balance measurement order across both schedules.
        if (sample % 2 === 0) {
          sequentialSamples.push(await measureBatch(false));
          concurrentSamples.push(await measureBatch(true));
        } else {
          concurrentSamples.push(await measureBatch(true));
          sequentialSamples.push(await measureBatch(false));
        }
      }
      const median = (samples: number[]) => {
        const sorted = [...samples].sort((left, right) => left - right);
        const middle = sorted.length / 2;
        return (sorted[middle - 1] + sorted[middle]) / 2;
      };
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
  const workerPaths = page
    .workers()
    .map((worker) => new URL(worker.url()).pathname);
  expect(
    workerPaths.filter((path) => path.endsWith("/vectorize.worker.ts")),
  ).toHaveLength(3);
  expect(workerPaths.some((path) => path.endsWith("/quantize.worker.ts"))).toBe(
    false,
  );

  console.log(
    `batch benchmark: ${result.sequentialMs.toFixed(1)}ms sequential, ${result.concurrentMs.toFixed(1)}ms pooled, ${(result.sequentialMs / result.concurrentMs).toFixed(2)}x throughput against ${minimumSpeedup.toFixed(2)}x floor, ${(result.peakHeapGrowth / 1024 / 1024).toFixed(1)} MiB peak / ${(result.heapGrowth / 1024 / 1024).toFixed(1)} MiB settled heap growth on ${result.hardwareConcurrency} logical CPUs`,
  );
  console.log(
    "batch samples (ms)",
    JSON.stringify({
      sequential: result.sequentialSamples,
      pooled: result.concurrentSamples,
    }),
  );
  expect(result.peakHeapGrowth).toBeLessThan(256 * 1024 * 1024);
  expect(result.heapGrowth).toBeLessThan(256 * 1024 * 1024);
  if (result.hardwareConcurrency >= 3)
    expect(result.sequentialMs / result.concurrentMs).toBeGreaterThanOrEqual(
      minimumSpeedup,
    );
});
