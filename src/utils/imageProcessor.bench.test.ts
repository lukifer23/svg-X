import { describe, expect, test } from 'vitest';
import { getOptimizedFilename } from './imageProcessor';

describe('performance-baseline', () => {
  test('filename optimizer stays fast under batch load', () => {
    const t0 = performance.now();
    for (let i = 0; i < 10000; i++) {
      getOptimizedFilename(`Fixture ${i} :: [raw] .png`);
    }
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(500);
  });
});
