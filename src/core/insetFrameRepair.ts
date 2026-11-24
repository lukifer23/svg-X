import type { ScanInkEvidence } from "./scanLighting";
import type { VectorSubpath } from "./vectorDocument";

export type FrameBounds = [
  left: number,
  top: number,
  right: number,
  bottom: number,
];

const rectangleBounds = (
  subpath: VectorSubpath,
  scale: number,
): FrameBounds | undefined => {
  if (!subpath.closed) return;
  const points = subpath.commands.filter((point) => point.type !== "Z");
  if (points.length < 4 || points.length > 48) return;
  const xs = points.map(({ x }) => x - 0.5);
  const ys = points.map(({ y }) => y - 0.5);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs);
  const minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const short = Math.min(maxX - minX, maxY - minY);
  const long = Math.max(maxX - minX, maxY - minY);
  if (short < 30 * scale || long > 160 * scale || long > short * 1.6) return;
  const margin = 2 * scale;
  if (
    points.some(
      (_, i) =>
        Math.min(xs[i] - minX, maxX - xs[i], ys[i] - minY, maxY - ys[i]) >
        margin,
    )
  )
    return;
  if (
    [minX, maxX].some((x) =>
      [minY, maxY].some(
        (y) =>
          !points.some(
            (_, i) =>
              Math.abs(xs[i] - x) <= margin && Math.abs(ys[i] - y) <= margin,
          ),
      ),
    )
  )
    return;
  return [minX, minY, maxX, maxY].map(Math.round) as FrameBounds;
};

export const repairInsetFrames = (
  subpaths: VectorSubpath[],
  skeleton: Uint8Array,
  width: number,
  height: number,
  { contrast, minimumContrast, resolutionScale: scale }: ScanInkEvidence,
) => {
  if (Math.max(width, height) < 1000) return [];
  const outlines = subpaths
    .map((path) => rectangleBounds(path, scale))
    .filter((box) => box !== undefined);
  const repaired: FrameBounds[] = [];
  for (const [l, t, r, b] of outlines) {
    const short = Math.min(r - l, b - t);
    const minInset = Math.max(3 * scale, Math.ceil(short * 0.05));
    const maxInset = Math.floor(short * 0.19);
    const scoreSide = (
      axis: number,
      from: number,
      to: number,
      vertical: boolean,
    ) => {
      let ink = 0,
        hits = 0,
        sum = 0,
        ridge = 0;
      const flank = scale * (vertical ? 2 : 2 * width);
      const near = vertical ? 1 : width;
      for (let v = from; v <= to; v++) {
        const i = vertical ? v * width + axis : axis * width + v;
        const value = contrast[i];
        ink += Number(value >= 2 * minimumContrast);
        ridge += Number(
          value - Math.min(contrast[i - flank], contrast[i + flank]) >=
            minimumContrast,
        );
        hits += Number(skeleton[i] || skeleton[i - near] || skeleton[i + near]);
        sum += Math.min(value, 4 * minimumContrast);
      }
      const n = to - from + 1;
      if (ink < 0.88 * n || ridge < 0.8 * n || hits < 0.65 * n)
        return -Infinity;
      return sum / n;
    };
    const bestAxis = (
      origin: number,
      sign: number,
      from: number,
      to: number,
      vertical: boolean,
    ) => {
      let best = -Infinity;
      let axis: number | undefined;
      for (let inset = minInset; inset <= maxInset; inset++) {
        const position = origin + sign * inset;
        const value = scoreSide(position, from, to, vertical);
        if (value > best) {
          best = value;
          axis = position;
        }
      }
      return axis;
    };
    const left = bestAxis(l, 1, t + maxInset, b - maxInset, true);
    const right = bestAxis(r, -1, t + maxInset, b - maxInset, true);
    const top = bestAxis(t, 1, l + maxInset, r - maxInset, false);
    const bottom = bestAxis(b, -1, l + maxInset, r - maxInset, false);
    if (
      left === undefined ||
      right === undefined ||
      top === undefined ||
      bottom === undefined
    )
      continue;
    if (
      outlines.some(
        (box) =>
          Math.abs(left - box[0]) +
            Math.abs(top - box[1]) +
            Math.abs(right - box[2]) +
            Math.abs(bottom - box[3]) <=
          4 * scale,
      )
    )
      continue;
    if (
      !Number.isFinite(scoreSide(left, top, bottom, true)) ||
      !Number.isFinite(scoreSide(right, top, bottom, true)) ||
      !Number.isFinite(scoreSide(top, left, right, false)) ||
      !Number.isFinite(scoreSide(bottom, left, right, false))
    )
      continue;
    const pixels: number[] = [];
    for (let x = left; x <= right; x++)
      pixels.push(top * width + x, bottom * width + x);
    for (let y = top + 1; y < bottom; y++)
      pixels.push(y * width + left, y * width + right);
    if (pixels.some((pixel) => contrast[pixel] < minimumContrast)) continue;
    if (pixels.every((pixel) => skeleton[pixel])) continue;
    for (const pixel of pixels) skeleton[pixel] = 1;
    repaired.push([left, top, right, bottom]);
  }
  return repaired;
};

// A crop is safe when no skeleton edge leaves it. An isolated dot
// or a stroke running along the border does not require a full rewalk.
export const isolatedFrameCrop = (
  mask: Uint8Array,
  width: number,
  height: number,
  [left, top, right, bottom]: FrameBounds,
  scale: number,
): FrameBounds | undefined => {
  for (let pad = scale; pad <= 10 * scale; pad++) {
    const l = left - pad,
      t = top - pad,
      r = right + pad,
      b = bottom + pad;
    if (l <= 0 || t <= 0 || r >= width - 1 || b >= height - 1) return;
    let separate = true;
    for (let x = l; separate && x <= r; x++) {
      const upper = t * width + x;
      const lower = b * width + x;
      separate =
        !(
          mask[upper] &&
          (mask[upper - width - 1] ||
            mask[upper - width] ||
            mask[upper - width + 1])
        ) &&
        !(
          mask[lower] &&
          (mask[lower + width - 1] ||
            mask[lower + width] ||
            mask[lower + width + 1])
        );
    }
    for (let y = t; separate && y <= b; y++) {
      const west = y * width + l;
      const east = y * width + r;
      separate =
        !(
          mask[west] &&
          (mask[west - 1 - width] || mask[west - 1] || mask[west - 1 + width])
        ) &&
        !(
          mask[east] &&
          (mask[east + 1 - width] || mask[east + 1] || mask[east + 1 + width])
        );
    }
    if (separate) return [l, t, r, b];
  }
};
