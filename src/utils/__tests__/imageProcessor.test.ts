import { describe, it, expect } from 'vitest';
import { calculateGrayscale } from '../imageProcessor';

describe('calculateGrayscale', () => {
  it('converts red to correct grayscale value', () => {
    expect(calculateGrayscale(255, 0, 0)).toBe(76);
  });

  it('converts green to correct grayscale value', () => {
    expect(calculateGrayscale(0, 255, 0)).toBe(150);
  });

  it('converts blue to correct grayscale value', () => {
    expect(calculateGrayscale(0, 0, 255)).toBe(29);
  });

  it('converts white to 255', () => {
    expect(calculateGrayscale(255, 255, 255)).toBe(255);
  });
});
