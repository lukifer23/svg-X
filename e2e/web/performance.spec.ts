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
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const module = await import("/src/utils/imageProcessor.ts");
    const size = 320;
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
      module.processImageDetailed(
        createInput(),
        params,
        () => undefined,
        undefined,
        undefined,
        "batch",
      );
    await convert();
    const beforeHeap =
      (performance as Performance & { memory?: { usedJSHeapSize: number } })
        .memory?.usedJSHeapSize ?? 0;
    const sequentialStart = performance.now();
    for (let index = 0; index < 8; index += 1) await convert();
    const sequentialMs = performance.now() - sequentialStart;
    const concurrentStart = performance.now();
    await Promise.all(Array.from({ length: 8 }, () => convert()));
    const concurrentMs = performance.now() - concurrentStart;
    const afterHeap =
      (performance as Performance & { memory?: { usedJSHeapSize: number } })
        .memory?.usedJSHeapSize ?? 0;
    return {
      hardwareConcurrency: navigator.hardwareConcurrency,
      sequentialMs,
      concurrentMs,
      heapGrowth: Math.max(0, afterHeap - beforeHeap),
    };
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
