import type { ScanInkEvidence } from "./scanLighting";

interface Tip {
  index: number;
  behind: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
}

interface Link {
  left: Tip;
  right: Tip;
  pixels: number[];
  score: number;
}

const MAX_GAP = 12;
const TANGENT_STEPS = 4;
const MIN_ALIGNMENT = 0.7;
const NEIGHBORS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
] as const;

export const repairFadedCurves = (
  skeleton: Uint8Array,
  width: number,
  height: number,
  { contrast, minimumContrast }: ScanInkEvidence,
  neighborsAt: (index: number) => number,
): void => {
  const offsets = NEIGHBORS.map(([dx, dy]) => dx + dy * width);
  const tips = new Map<number, Tip[]>();
  const columns = Math.ceil(width / MAX_GAP);
  const firstDirection = (bits: number) => 31 - Math.clz32(bits & -bits);
  for (let index = 0; index < skeleton.length; index += 1) {
    if (!skeleton[index]) continue;
    const bits = neighborsAt(index);
    if (!bits || bits & (bits - 1)) continue;
    let direction = firstDirection(bits);
    let current = index;
    let steps = 0;
    for (; steps < TANGENT_STEPS; steps += 1) {
      current += offsets[direction];
      const next = neighborsAt(current) & ~(1 << ((direction + 4) % 8));
      if (!next || next & (next - 1)) break;
      direction = firstDirection(next);
    }
    if (steps < TANGENT_STEPS - 1) continue;
    const x = index % width;
    const y = (index - x) / width;
    const dx = x - (current % width);
    const dy = y - Math.floor(current / width);
    const length = Math.hypot(dx, dy);
    if (length < 2) continue;
    const key = Math.floor(y / MAX_GAP) * columns + Math.floor(x / MAX_GAP);
    const bucket = tips.get(key) ?? [];
    bucket.push({
      index,
      behind: index + offsets[firstDirection(bits)],
      x,
      y,
      dx: dx / length,
      dy: dy / length,
    });
    tips.set(key, bucket);
  }

  const inside = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height;
  const inkFloor = Math.max(6, Math.ceil(minimumContrast * 0.35));
  const touchesOtherStroke = (pixel: number, left: Tip, right: Tip) => {
    if (skeleton[pixel]) return true;
    const x = pixel % width;
    const y = (pixel - x) / width;
    for (const [dx, dy] of NEIGHBORS) {
      if (!inside(x + dx, y + dy)) continue;
      const next = pixel + dx + dy * width;
      if (next === left.index || next === right.index || !skeleton[next])
        continue;
      // Ignore diagonal shortcuts through the endpoint, as the skeleton
      // walker does. Every other contact makes the bridge ambiguous.
      if (
        dx !== 0 &&
        dy !== 0 &&
        ((next === left.behind &&
          (pixel + dx === left.index || pixel + dy * width === left.index)) ||
          (next === right.behind &&
            (pixel + dx === right.index || pixel + dy * width === right.index)))
      )
        continue;
      return true;
    }
    return false;
  };

  const findLink = (left: Tip, right: Tip): Link | undefined => {
    const dx = right.x - left.x;
    const dy = right.y - left.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared < 4 || lengthSquared > MAX_GAP * MAX_GAP) return;
    const length = Math.sqrt(lengthSquared);
    const alignmentLeft = (dx * left.dx + dy * left.dy) / length;
    const alignmentRight = -(dx * right.dx + dy * right.dy) / length;
    if (alignmentLeft < MIN_ALIGNMENT || alignmentRight < MIN_ALIGNMENT) return;

    const normalX = -dy / length;
    const normalY = dx / length;
    const nx = Math.round(normalX * 2);
    const ny = Math.round(normalY * 2);
    const flankOffset = ny * width + nx;
    const handle = length / 3;
    const count = Math.ceil(length * 3);
    const sample = (bias: number): Link | undefined => {
      const pixels: number[] = [];
      let raised = 0;
      let last = left.index;
      for (let step = 1; step < count; step += 1) {
        const t = step / count;
        const u = 1 - t;
        const leftWeight = 3 * u * u * t;
        const rightWeight = 3 * u * t * t;
        const base = rightWeight + t * t * t;
        const offset = 4 * t * u * bias;
        const x = Math.round(
          left.x +
            dx * base +
            handle * (leftWeight * left.dx + rightWeight * right.dx) +
            normalX * offset,
        );
        const y = Math.round(
          left.y +
            dy * base +
            handle * (leftWeight * left.dy + rightWeight * right.dy) +
            normalY * offset,
        );
        if (!inside(x, y)) return;
        const index = y * width + x;
        if (index === last || index === right.index) continue;
        if (
          contrast[index] < inkFloor ||
          touchesOtherStroke(index, left, right)
        )
          return;
        if (!inside(x + nx, y + ny) || !inside(x - nx, y - ny)) return;
        if (
          contrast[index] -
            Math.max(
              contrast[index - flankOffset],
              contrast[index + flankOffset],
            ) >=
          3
        )
          raised += 1;
        pixels.push(index);
        last = index;
      }
      if (!pixels.length || raised * 4 < pixels.length * 3) return;
      // Prefer the unshifted trajectory and penalize curvature mismatch.
      return {
        left,
        right,
        pixels,
        score:
          length + 3 * (2 - alignmentLeft - alignmentRight) + Math.abs(bias),
      };
    };
    return sample(0) ?? sample(0.65) ?? sample(-0.65);
  };

  const best = new Map<number, { link: Link; alternative: number }>();
  const offer = (index: number, link: Link) => {
    const entry = best.get(index);
    if (!entry) best.set(index, { link, alternative: Infinity });
    else if (link.score < entry.link.score)
      best.set(index, { link, alternative: entry.link.score });
    else entry.alternative = Math.min(entry.alternative, link.score);
  };
  for (const [key, bucket] of tips) {
    const column = key % columns;
    const row = (key - column) / columns;
    for (let y = Math.max(0, row - 1); y <= row + 1; y += 1) {
      for (
        let x = Math.max(0, column - 1);
        x <= Math.min(columns - 1, column + 1);
        x += 1
      ) {
        for (const right of tips.get(y * columns + x) ?? []) {
          for (const left of bucket) {
            if (left.index >= right.index) continue;
            const link = findLink(left, right);
            if (!link) continue;
            offer(left.index, link);
            offer(right.index, link);
          }
        }
      }
    }
  }
  for (const [index, { link, alternative }] of best) {
    if (index !== link.left.index || alternative - link.score < 0.6) continue;
    const other = best.get(link.right.index);
    if (other?.link !== link || other.alternative - link.score < 0.6) continue;
    const { left, right, pixels } = link;
    if (pixels.some((pixel) => touchesOtherStroke(pixel, left, right)))
      continue;
    for (const pixel of pixels) skeleton[pixel] = 1;
  }
};
