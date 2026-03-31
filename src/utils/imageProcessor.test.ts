import { describe, expect, test } from 'vitest';
import { simplifyForNetworkClients, DEFAULT_PARAMS, getOptimizedFilename } from './imageProcessor';

describe('simplifyForNetworkClients', () => {
  test('increases threshold with upper bound enforcement', () => {
    const params = { ...DEFAULT_PARAMS, threshold: 128 };
    const result = simplifyForNetworkClients(params);
    expect(result.threshold).toBe(210); // 180 from complex + 30, capped below 255
    expect(result.threshold).toBeLessThanOrEqual(255);
  });
});

describe('getOptimizedFilename', () => {
  test('slugifies complex filenames safely', () => {
    expect(getOptimizedFilename('My Complex Image (Draft)!!.PNG')).toBe('my-complex-image-draft');
  });

  test('falls back for empty names', () => {
    expect(getOptimizedFilename('....')).toBe('image');
  });
});
