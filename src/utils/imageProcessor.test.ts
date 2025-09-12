import { describe, expect, test } from 'vitest';
import { resizeImage } from './imageProcessor';
import { Image, createCanvas } from 'canvas';

// Polyfill global Image and document for the resizing helper
(global as any).Image = Image;
(global as any).document = {
  createElement: (name: string) => {
    if (name === 'canvas') {
      return createCanvas(0, 0);
    }
    throw new Error('Unsupported element');
  }
};

describe('resizeImage', () => {
  test('scales images larger than max dimension', async () => {
    const canvas = createCanvas(2000, 500);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 2000, 500);
    const dataUrl = canvas.toDataURL('image/png');

    const scaled = await resizeImage(dataUrl, { maxDimension: 1000 });
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (err) => reject(err);
      img.src = scaled;
    });
    expect(img.width).toBe(1000);
    expect(img.height).toBe(250);
  });

  test('returns original image when within limits', async () => {
    const canvas = createCanvas(800, 600);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 800, 600);
    const dataUrl = canvas.toDataURL('image/png');

    const scaled = await resizeImage(dataUrl, { maxDimension: 1000 });
    expect(scaled).toBe(dataUrl);
  });

  test('downscales image by scale factor', async () => {
    const canvas = createCanvas(1200, 600);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 1200, 600);
    const dataUrl = canvas.toDataURL('image/png');

    const scaled = await resizeImage(dataUrl, { scale: 0.5 });
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (err) => reject(err);
      img.src = scaled;
    });
    expect(img.width).toBe(600);
    expect(img.height).toBe(300);
  });
});

