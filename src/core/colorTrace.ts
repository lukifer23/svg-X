import { fitPointsToSubpath } from "./curveFit";
import {
  pointsToSubpath,
  ringArea,
  simplifyRing,
  type Point,
} from "./geometry";
import type {
  VectorDocument,
  VectorShape,
  WorkerConversionOptions,
} from "./vectorDocument";

interface LabColor {
  l: number;
  a: number;
  b: number;
}
interface PaletteColor extends LabColor {
  r: number;
  g: number;
  blue: number;
  count: number;
}
type HistogramColor = PaletteColor;
interface Edge {
  start: Point;
  end: Point;
  direction: number;
  used: boolean;
}

const srgbToLinear = (channel: number): number => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

export const rgbToOklab = (r: number, g: number, b: number): LabColor => {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);
  return {
    l: 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    a: 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    b: 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
  };
};

const distance = (left: LabColor, right: LabColor): number =>
  (left.l - right.l) ** 2 + (left.a - right.a) ** 2 + (left.b - right.b) ** 2;

const histogram = (pixels: Uint8ClampedArray): HistogramColor[] => {
  const bins = new Map<
    number,
    { count: number; r: number; g: number; b: number }
  >();
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 8) continue;
    const r = pixels[index];
    const g = pixels[index + 1];
    const b = pixels[index + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const bin = bins.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bin.count += 1;
    bin.r += r;
    bin.g += g;
    bin.b += b;
    bins.set(key, bin);
  }
  return [...bins.values()].map((bin) => {
    const r = bin.r / bin.count;
    const g = bin.g / bin.count;
    const b = bin.b / bin.count;
    return { ...rgbToOklab(r, g, b), r, g, blue: b, count: bin.count };
  });
};

const boxVariance = (colors: HistogramColor[]): number => {
  const count = colors.reduce((sum, color) => sum + color.count, 0) || 1;
  const mean = colors.reduce(
    (sum, color) => ({
      l: sum.l + color.l * color.count,
      a: sum.a + color.a * color.count,
      b: sum.b + color.b * color.count,
    }),
    { l: 0, a: 0, b: 0 },
  );
  mean.l /= count;
  mean.a /= count;
  mean.b /= count;
  return colors.reduce(
    (sum, color) => sum + distance(color, mean) * color.count,
    0,
  );
};

const splitBox = (
  colors: HistogramColor[],
): [HistogramColor[], HistogramColor[]] => {
  const ranges = (["l", "a", "b"] as const).map((axis) => ({
    axis,
    range:
      Math.max(...colors.map((color) => color[axis])) -
      Math.min(...colors.map((color) => color[axis])),
  }));
  const axis = ranges.sort((left, right) => right.range - left.range)[0].axis;
  const sorted = colors.slice().sort((left, right) => left[axis] - right[axis]);
  const total = sorted.reduce((sum, color) => sum + color.count, 0);
  let cumulative = 0;
  let split = 1;
  let bestDifference = Number.POSITIVE_INFINITY;
  for (let index = 1; index < sorted.length; index += 1) {
    cumulative += sorted[index - 1].count;
    const difference = Math.abs(total - cumulative * 2);
    if (difference < bestDifference) {
      bestDifference = difference;
      split = index;
    }
  }
  return [sorted.slice(0, split), sorted.slice(split)];
};

export const wuVarianceSeeds = (
  pixels: Uint8ClampedArray,
  requested: number,
): PaletteColor[] => {
  const colors = histogram(pixels);
  if (colors.length === 0)
    return [
      { ...rgbToOklab(255, 255, 255), r: 255, g: 255, blue: 255, count: 1 },
    ];
  const boxes: HistogramColor[][] = [colors];
  while (boxes.length < requested) {
    let boxIndex = -1;
    let variance = -1;
    boxes.forEach((box, index) => {
      const candidate = box.length > 1 ? boxVariance(box) : -1;
      if (candidate > variance) {
        variance = candidate;
        boxIndex = index;
      }
    });
    if (boxIndex < 0) break;
    const [left, right] = splitBox(boxes[boxIndex]);
    if (left.length === 0 || right.length === 0) break;
    boxes.splice(boxIndex, 1, left, right);
  }
  return boxes.map((box) => {
    const count = box.reduce((sum, color) => sum + color.count, 0) || 1;
    const r =
      box.reduce((sum, color) => sum + color.r * color.count, 0) / count;
    const g =
      box.reduce((sum, color) => sum + color.g * color.count, 0) / count;
    const b =
      box.reduce((sum, color) => sum + color.blue * color.count, 0) / count;
    return { ...rgbToOklab(r, g, b), r, g, blue: b, count };
  });
};

const averageSeed = (colors: HistogramColor[]): PaletteColor => {
  const count = colors.reduce((sum, color) => sum + color.count, 0) || 1;
  const r =
    colors.reduce((sum, color) => sum + color.r * color.count, 0) / count;
  const g =
    colors.reduce((sum, color) => sum + color.g * color.count, 0) / count;
  const b =
    colors.reduce((sum, color) => sum + color.blue * color.count, 0) / count;
  return { ...rgbToOklab(r, g, b), r, g, blue: b, count };
};

const tonalSeeds = (
  pixels: Uint8ClampedArray,
  requested: number,
  strategy: WorkerConversionOptions["fillStrategy"],
): PaletteColor[] => {
  const colors = histogram(pixels).sort((left, right) => left.l - right.l);
  if (colors.length === 0) return wuVarianceSeeds(pixels, requested);
  const count = Math.min(requested, colors.length);
  if (strategy === "spread") {
    if (count === 1) return [averageSeed(colors)];
    return Array.from(
      { length: count },
      (_, index) =>
        colors[Math.round((index * (colors.length - 1)) / (count - 1))],
    );
  }

  const groups: HistogramColor[][] = Array.from({ length: count }, () => []);
  if (strategy === "mean") {
    const minimum = colors[0].l;
    const range = Math.max(
      Number.EPSILON,
      colors[colors.length - 1].l - minimum,
    );
    for (const color of colors) {
      const index = Math.min(
        count - 1,
        Math.floor(((color.l - minimum) / range) * count),
      );
      groups[index].push(color);
    }
  } else {
    const total = colors.reduce((sum, color) => sum + color.count, 0);
    let cumulative = 0;
    for (const color of colors) {
      const midpoint = cumulative + color.count / 2;
      groups[Math.min(count - 1, Math.floor((midpoint / total) * count))].push(
        color,
      );
      cumulative += color.count;
    }
  }
  return groups.filter((group) => group.length > 0).map(averageSeed);
};

export const paletteSeeds = (
  pixels: Uint8ClampedArray,
  requested: number,
  strategy: WorkerConversionOptions["fillStrategy"],
): PaletteColor[] =>
  strategy === "dominant"
    ? wuVarianceSeeds(pixels, requested)
    : tonalSeeds(pixels, requested, strategy);

const refinePalette = (
  pixels: Uint8ClampedArray,
  seeds: PaletteColor[],
): PaletteColor[] => {
  let palette = seeds;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const sums = palette.map(() => ({ r: 0, g: 0, b: 0, count: 0 }));
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] < 8) continue;
      const lab = rgbToOklab(
        pixels[index],
        pixels[index + 1],
        pixels[index + 2],
      );
      let closest = 0;
      let closestDistance = Number.POSITIVE_INFINITY;
      palette.forEach((color, candidate) => {
        const candidateDistance = distance(lab, color);
        if (candidateDistance < closestDistance) {
          closestDistance = candidateDistance;
          closest = candidate;
        }
      });
      sums[closest].r += pixels[index];
      sums[closest].g += pixels[index + 1];
      sums[closest].b += pixels[index + 2];
      sums[closest].count += 1;
    }
    palette = palette.map((color, index) => {
      const sum = sums[index];
      if (sum.count === 0) return color;
      const r = sum.r / sum.count;
      const g = sum.g / sum.count;
      const b = sum.b / sum.count;
      return { ...rgbToOklab(r, g, b), r, g, blue: b, count: sum.count };
    });
  }
  return palette;
};

const labelPixels = (
  pixels: Uint8ClampedArray,
  palette: PaletteColor[],
): Uint8Array => {
  const labels = new Uint8Array(pixels.length / 4);
  for (let pixel = 0; pixel < labels.length; pixel += 1) {
    const index = pixel * 4;
    const lab = rgbToOklab(pixels[index], pixels[index + 1], pixels[index + 2]);
    let closest = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    palette.forEach((color, candidate) => {
      const candidateDistance = distance(lab, color);
      if (candidateDistance < closestDistance) {
        closestDistance = candidateDistance;
        closest = candidate;
      }
    });
    labels[pixel] = closest;
  }
  return labels;
};

const pointKey = (point: Point): string => `${point.x},${point.y}`;

const traceBoundaries = (
  labels: Uint8Array,
  width: number,
  height: number,
  label: number,
): Point[][] => {
  const edges: Edge[] = [];
  const outgoing = new Map<string, number[]>();
  const add = (start: Point, end: Point, direction: number) => {
    const index = edges.push({ start, end, direction, used: false }) - 1;
    const key = pointKey(start);
    outgoing.set(key, [...(outgoing.get(key) ?? []), index]);
  };
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= width || y >= height ? -1 : labels[y * width + x];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (at(x, y) !== label) continue;
      if (at(x, y - 1) !== label) add({ x, y }, { x: x + 1, y }, 0);
      if (at(x + 1, y) !== label)
        add({ x: x + 1, y }, { x: x + 1, y: y + 1 }, 1);
      if (at(x, y + 1) !== label)
        add({ x: x + 1, y: y + 1 }, { x, y: y + 1 }, 2);
      if (at(x - 1, y) !== label) add({ x, y: y + 1 }, { x, y }, 3);
    }
  }
  const rings: Point[][] = [];
  edges.forEach((edge) => {
    if (edge.used) return;
    const ring: Point[] = [];
    let current = edge;
    const startKey = pointKey(edge.start);
    while (!current.used) {
      current.used = true;
      ring.push(current.start);
      const candidates = (outgoing.get(pointKey(current.end)) ?? [])
        .map((index) => edges[index])
        .filter((candidate) => !candidate.used);
      if (candidates.length === 0) break;
      const priority = (candidate: Edge): number => {
        const turn = (candidate.direction - current.direction + 4) % 4;
        return turn === 1 ? 0 : turn === 0 ? 1 : turn === 3 ? 2 : 3;
      };
      current = candidates.sort(
        (left, right) => priority(left) - priority(right),
      )[0];
      if (pointKey(current.start) === startKey && current.used) break;
    }
    if (ring.length >= 4 && pointKey(current.end) === startKey)
      rings.push(ring);
  });
  return rings;
};

const rgb = (color: PaletteColor): string =>
  `rgb(${Math.round(color.r)},${Math.round(color.g)},${Math.round(color.blue)})`;

export const canonicalShape = (shape: VectorShape): string =>
  `${shape.fill}|${shape.stroke}|${shape.strokeWidth}|${shape.opacity}|${shape.fillRule}|${shape.subpaths.map((path) => `${path.closed}:${path.commands.map((command) => JSON.stringify(command)).join(",")}`).join(";")}`;

export const deduplicateShapes = (shapes: VectorShape[]): VectorShape[] => {
  const buckets = new Map<number, string[]>();
  return shapes.filter((shape) => {
    const value = canonicalShape(shape);
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1)
      hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
    const bucket = buckets.get(hash) ?? [];
    if (bucket.includes(value)) return false;
    bucket.push(value);
    buckets.set(hash, bucket);
    return true;
  });
};

export const traceColorDocument = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: WorkerConversionOptions,
): VectorDocument => {
  const palette = refinePalette(
    pixels,
    paletteSeeds(
      pixels,
      Math.max(2, Math.min(8, options.colorSteps)),
      options.fillStrategy,
    ),
  );
  const labels = labelPixels(pixels, palette);
  const indexed = palette
    .map((color, index) => ({ color, index }))
    .sort((left, right) => right.color.count - left.color.count);
  let remaining = Math.max(1, options.maxPaths);
  const shapes: VectorShape[] = [];
  indexed.forEach(({ color, index }) => {
    const rings = traceBoundaries(labels, width, height, index)
      .map((points) => ({
        points: simplifyRing(points, Math.max(0.15, options.optTolerance)),
        area: Math.abs(ringArea(points)),
      }))
      .filter(
        (ring) =>
          ring.points.length >= 3 && ring.area >= Math.max(1, options.turdSize),
      )
      .sort((left, right) => right.area - left.area)
      .slice(0, remaining);
    remaining -= rings.length;
    if (rings.length === 0) return;
    shapes.push({
      id: `color-${index}`,
      fill: rgb(color),
      stroke: "none",
      strokeWidth: 0,
      opacity: 1,
      fillRule: "evenodd",
      subpaths: rings.map((ring) =>
        options.optCurve
          ? fitPointsToSubpath(
              ring.points,
              true,
              Math.max(0.05, options.optTolerance),
            )
          : pointsToSubpath(ring.points, true),
      ),
    });
  });
  return {
    version: 1,
    width,
    height,
    mode: "color",
    shapes: deduplicateShapes(shapes),
  };
};
