import type { Point } from "./geometry";

// Directions go clockwise around each pixel, starting at its top edge.
const STEP_X = [1, 0, -1, 0];
const STEP_Y = [0, 1, 0, -1];
const CELL_X = [0, -1, -1, 0];
const CELL_Y = [0, 0, -1, -1];
const TURN_ORDER = [1, 0, 3, 2];

interface ColorRing {
  points: Point[];
  area: number;
}

export const traceColorBoundaries = (
  labels: Uint8Array,
  width: number,
  height: number,
  paletteSize: number,
): ColorRing[][] => {
  const rings: ColorRing[][] = Array.from({ length: paletteSize }, () => []);
  // Store the four directed sides in one byte per pixel. Clear a bit as its
  // side is walked. Adjacent colors each own their side of a shared boundary.
  const remaining = new Uint8Array(labels.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const pixel = row + x;
      const label = labels[pixel];
      if (label >= paletteSize) continue;
      remaining[pixel] =
        Number(y === 0 || labels[pixel - width] !== label) |
        (Number(x === width - 1 || labels[pixel + 1] !== label) << 1) |
        (Number(y === height - 1 || labels[pixel + width] !== label) << 2) |
        (Number(x === 0 || labels[pixel - 1] !== label) << 3);
    }
  }

  // Row-major seeds and clockwise sides preserve ring order within each label.
  for (let seed = 0; seed < remaining.length; seed += 1) {
    while (remaining[seed]) {
      const seedMask = remaining[seed];
      let direction = 31 - Math.clz32(seedMask & -seedMask);
      const rowX = seed % width;
      const startX = rowX - CELL_X[direction];
      const startY = (seed - rowX) / width - CELL_Y[direction];
      const label = labels[seed];
      const ring: Point[] = [];
      let twiceArea = 0;
      let pixel = seed;
      let x = startX;
      let y = startY;

      while (pixel >= 0) {
        remaining[pixel] &= ~(1 << direction);
        ring.push({ x, y });
        const dx = STEP_X[direction];
        const dy = STEP_Y[direction];
        // Shoelace contribution for this unit edge, before stepping.
        twiceArea += x * dy - y * dx;
        x += dx;
        y += dy;
        pixel = -1;
        // At diagonal contacts, turn right first to keep the same pixel-side
        // pairing as the original directed-edge walk.
        for (let choice = 0; choice < TURN_ORDER.length; choice += 1) {
          const next = (direction + TURN_ORDER[choice]) & 3;
          const cellX = x + CELL_X[next];
          const cellY = y + CELL_Y[next];
          if (cellX < 0 || cellX >= width || cellY < 0 || cellY >= height)
            continue;
          const candidate = cellY * width + cellX;
          if (
            labels[candidate] !== label ||
            !(remaining[candidate] & (1 << next))
          )
            continue;
          direction = next;
          pixel = candidate;
          break;
        }
      }

      if (ring.length >= 4 && x === startX && y === startY)
        rings[label].push({ points: ring, area: twiceArea / 2 });
    }
  }
  return rings;
};
