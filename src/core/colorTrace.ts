import { ringArea } from "./geometry";
import { traceColorBoundaries } from "./colorBoundaries";
import { createSharedBoundaryFitter } from "./sharedColorBoundaries";
import {
  MAX_PALETTE_COLORS,
  type VectorDocument,
  type VectorShape,
  type WorkerConversionOptions,
} from "./vectorDocument";

interface LabColor {
  l: number;
  a: number;
  b: number;
}
export interface PaletteColor extends LabColor {
  r: number;
  g: number;
  blue: number;
  count: number;
}
export interface PixelLabs {
  l: Float32Array;
  a: Float32Array;
  b: Float32Array;
  occurrences?: Int32Array;
}
type HistogramColor = PaletteColor;
interface LabelComponent {
  id: number;
  label: number;
  area: number;
  neighbors: Map<number, number>;
}

const srgbToLinear = (channel: number): number => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

// sRGB->linear for the 8-bit channel domain is a pure lookup; the table is
// bit-identical to srgbToLinear(channel) and removes the per-channel pow.
const SRGB_LINEAR = Float64Array.from({ length: 256 }, (_value, channel) =>
  srgbToLinear(channel),
);

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

const rgbKey = (red: number, green: number, blue: number): number =>
  ((red << 16) | (green << 8) | blue) + 1;

const cacheSlot = (key: number, shift: number): number =>
  Math.imul(key, 0x9e3779b1) >>> shift;

const hasColorReuse = (
  pixels: Uint8ClampedArray,
  keys: Uint32Array,
  shift: number,
): boolean => {
  const length = pixels.length / 4;
  const windowSize = 4096;
  if (length <= 4 * windowSize) return true;
  let hits = 0;
  // Sample contiguous windows across the image to detect spatial reuse.
  for (let window = 0; window < 4; window += 1) {
    const start = Math.floor((window * (length - windowSize)) / 3) * 4;
    for (let offset = start; offset < start + windowSize * 4; offset += 4) {
      const key = rgbKey(
        pixels[offset],
        pixels[offset + 1],
        pixels[offset + 2],
      );
      const slot = cacheSlot(key, shift);
      if (keys[slot] === key) hits += 1;
      keys[slot] = key;
    }
  }
  keys.fill(0);
  return hits >= windowSize / 2;
};

const writePixelLab = (
  { l, a, b }: PixelLabs,
  pixel: number,
  lr: number,
  lg: number,
  lb: number,
): void => {
  const lRoot = Math.cbrt(
    0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb,
  );
  const mRoot = Math.cbrt(
    0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb,
  );
  const sRoot = Math.cbrt(
    0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb,
  );
  l[pixel] = 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot;
  a[pixel] = 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot;
  b[pixel] = 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot;
};

export const precomputePixelLabs = (pixels: Uint8ClampedArray): PixelLabs => {
  const length = pixels.length / 4;
  const l = new Float32Array(length);
  const a = new Float32Array(length);
  const b = new Float32Array(length);
  const labs: PixelLabs = { l, a, b };
  const bits = Math.max(4, Math.min(16, 31 - Math.clz32(length)));
  const keys = new Uint32Array(1 << bits);
  const shift = 32 - bits;
  if (!hasColorReuse(pixels, keys, shift)) {
    for (let pixel = 0; pixel < length; pixel += 1) {
      const offset = pixel * 4;
      writePixelLab(
        labs,
        pixel,
        SRGB_LINEAR[pixels[offset]],
        SRGB_LINEAR[pixels[offset + 1]],
        SRGB_LINEAR[pixels[offset + 2]],
      );
    }
    return labs;
  }
  const indices = new Uint32Array(keys.length);
  // A positive entry is the opaque count for the representative pixel.
  // A negative entry points back to it. Zero marks transparency.
  const occurrences = new Int32Array(length);
  labs.occurrences = occurrences;
  for (let pixel = 0; pixel < length; pixel += 1) {
    const offset = pixel * 4;
    const red = pixels[offset];
    const green = pixels[offset + 1];
    const blue = pixels[offset + 2];
    const key = rgbKey(red, green, blue);
    const slot = cacheSlot(key, shift);
    const opaque = pixels[offset + 3] >= 8;
    if (keys[slot] === key) {
      const previous = indices[slot];
      l[pixel] = l[previous];
      a[pixel] = a[previous];
      b[pixel] = b[previous];
      if (opaque) {
        if (occurrences[previous] > 0) {
          occurrences[previous] += 1;
          occurrences[pixel] = -1 - previous;
        } else {
          // Reuse Lab from a transparent pixel, and start the opaque group here.
          indices[slot] = pixel;
          occurrences[pixel] = 1;
        }
      }
      continue;
    }
    keys[slot] = key;
    indices[slot] = pixel;
    if (opaque) occurrences[pixel] = 1;
    writePixelLab(
      labs,
      pixel,
      SRGB_LINEAR[red],
      SRGB_LINEAR[green],
      SRGB_LINEAR[blue],
    );
  }
  return labs;
};

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

interface WuBox {
  r0: number;
  r1: number;
  g0: number;
  g1: number;
  b0: number;
  b1: number;
}

interface WuMoments {
  weight: Float64Array;
  red: Float64Array;
  green: Float64Array;
  blue: Float64Array;
  squared: Float64Array;
}

const WU_SIDE = 33;
const wuIndex = (r: number, g: number, b: number): number =>
  (r * WU_SIDE + g) * WU_SIDE + b;

const cumulativeWuMoments = (pixels: Uint8ClampedArray): WuMoments => {
  const size = WU_SIDE ** 3;
  const moments: WuMoments = {
    weight: new Float64Array(size),
    red: new Float64Array(size),
    green: new Float64Array(size),
    blue: new Float64Array(size),
    squared: new Float64Array(size),
  };
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3] < 8) continue;
    const r = pixels[offset];
    const g = pixels[offset + 1];
    const b = pixels[offset + 2];
    const index = wuIndex((r >> 3) + 1, (g >> 3) + 1, (b >> 3) + 1);
    moments.weight[index] += 1;
    moments.red[index] += r;
    moments.green[index] += g;
    moments.blue[index] += b;
    moments.squared[index] += r * r + g * g + b * b;
  }
  for (const moment of Object.values(moments)) {
    const area = new Float64Array(WU_SIDE * WU_SIDE);
    for (let r = 1; r < WU_SIDE; r += 1) {
      area.fill(0);
      for (let g = 1; g < WU_SIDE; g += 1) {
        let line = 0;
        for (let b = 1; b < WU_SIDE; b += 1) {
          line += moment[wuIndex(r, g, b)];
          const areaIndex = g * WU_SIDE + b;
          area[areaIndex] = area[(g - 1) * WU_SIDE + b] + line;
          moment[wuIndex(r, g, b)] =
            moment[wuIndex(r - 1, g, b)] + area[areaIndex];
        }
      }
    }
  }
  return moments;
};

const wuVolume = (box: WuBox, moment: Float64Array): number =>
  moment[wuIndex(box.r1, box.g1, box.b1)] -
  moment[wuIndex(box.r1, box.g1, box.b0)] -
  moment[wuIndex(box.r1, box.g0, box.b1)] +
  moment[wuIndex(box.r1, box.g0, box.b0)] -
  moment[wuIndex(box.r0, box.g1, box.b1)] +
  moment[wuIndex(box.r0, box.g1, box.b0)] +
  moment[wuIndex(box.r0, box.g0, box.b1)] -
  moment[wuIndex(box.r0, box.g0, box.b0)];

const wuVariance = (box: WuBox, moments: WuMoments): number => {
  const weight = wuVolume(box, moments.weight);
  if (weight <= 0) return 0;
  const red = wuVolume(box, moments.red);
  const green = wuVolume(box, moments.green);
  const blue = wuVolume(box, moments.blue);
  return (
    wuVolume(box, moments.squared) -
    (red * red + green * green + blue * blue) / weight
  );
};

const splitWuBox = (box: WuBox, moments: WuMoments): [WuBox, WuBox] | null => {
  let best: { axis: "r" | "g" | "b"; cut: number; score: number } | null = null;
  for (const axis of ["r", "g", "b"] as const) {
    const low = box[`${axis}0`];
    const high = box[`${axis}1`];
    for (let cut = low + 1; cut < high; cut += 1) {
      const left = { ...box, [`${axis}1`]: cut } as WuBox;
      const right = { ...box, [`${axis}0`]: cut } as WuBox;
      if (
        wuVolume(left, moments.weight) <= 0 ||
        wuVolume(right, moments.weight) <= 0
      )
        continue;
      // The parent variance is fixed. Minimize the error left in the children.
      const score = wuVariance(left, moments) + wuVariance(right, moments);
      if (!best || score < best.score) best = { axis, cut, score };
    }
  }
  if (!best) return null;
  return [
    { ...box, [`${best.axis}1`]: best.cut } as WuBox,
    { ...box, [`${best.axis}0`]: best.cut } as WuBox,
  ];
};

export const wuVarianceSeeds = (
  pixels: Uint8ClampedArray,
  requested: number,
): PaletteColor[] => {
  const moments = cumulativeWuMoments(pixels);
  const full: WuBox = { r0: 0, r1: 32, g0: 0, g1: 32, b0: 0, b1: 32 };
  if (wuVolume(full, moments.weight) <= 0)
    return [
      { ...rgbToOklab(255, 255, 255), r: 255, g: 255, blue: 255, count: 1 },
    ];
  const boxes: WuBox[] = [full];
  while (boxes.length < requested) {
    const candidates = boxes
      .map((box, index) => ({ index, variance: wuVariance(box, moments) }))
      .sort((left, right) => right.variance - left.variance);
    let didSplit = false;
    for (const { index, variance } of candidates) {
      if (variance <= 0) break;
      const split = splitWuBox(boxes[index], moments);
      if (!split) continue;
      boxes.splice(index, 1, ...split);
      didSplit = true;
      break;
    }
    if (!didSplit) break;
  }
  return boxes.map((box) => {
    const count = wuVolume(box, moments.weight) || 1;
    const r = wuVolume(box, moments.red) / count;
    const g = wuVolume(box, moments.green) / count;
    const b = wuVolume(box, moments.blue) / count;
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

/**
 * Adds every opaque pixel's contribution to per-candidate sums. `sums` has
 * length `palette.length * 4` holding [r, g, b, count] per candidate. Channel
 * sums and counts are exact integers, so the same partial sums can be produced
 * by splitting the pixels into contiguous bands and adding the band partials in
 * order — which is what the parallel quantizer relies on.
 */
export const accumulatePaletteSums = (
  pixels: Uint8ClampedArray,
  labs: PixelLabs,
  palette: LabColor[],
  sums: Float64Array,
): void => {
  const labL = labs.l;
  const labA = labs.a;
  const labB = labs.b;
  const occurrences = labs.occurrences;
  const k = palette.length;
  const count = pixels.length / 4;
  const palL = new Float64Array(k);
  const palA = new Float64Array(k);
  const palB = new Float64Array(k);
  for (let candidate = 0; candidate < k; candidate += 1) {
    const color = palette[candidate];
    palL[candidate] = color.l;
    palA[candidate] = color.a;
    palB[candidate] = color.b;
  }
  for (let pixel = 0; pixel < count; pixel += 1) {
    const index = pixel * 4;
    const weight = occurrences
      ? occurrences[pixel]
      : Number(pixels[index + 3] >= 8);
    if (weight <= 0) continue;
    const pl = labL[pixel];
    const pa = labA[pixel];
    const pb = labB[pixel];
    let closest = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (let candidate = 0; candidate < k; candidate += 1) {
      const dl = pl - palL[candidate];
      const da = pa - palA[candidate];
      const db = pb - palB[candidate];
      const candidateDistance = dl * dl + da * da + db * db;
      if (candidateDistance < closestDistance) {
        closestDistance = candidateDistance;
        closest = candidate;
      }
    }
    sums[closest * 4] += pixels[index] * weight;
    sums[closest * 4 + 1] += pixels[index + 1] * weight;
    sums[closest * 4 + 2] += pixels[index + 2] * weight;
    sums[closest * 4 + 3] += weight;
  }
};

export const paletteFromSums = (
  palette: PaletteColor[],
  sums: Float64Array,
): PaletteColor[] =>
  palette.map((color, index) => {
    const n = sums[index * 4 + 3];
    if (n === 0) return color;
    const r = sums[index * 4] / n;
    const g = sums[index * 4 + 1] / n;
    const b = sums[index * 4 + 2] / n;
    return { ...rgbToOklab(r, g, b), r, g, blue: b, count: n };
  });

export const refinePalette = (
  pixels: Uint8ClampedArray,
  labs: PixelLabs,
  seeds: PaletteColor[],
): PaletteColor[] => {
  let palette = seeds;
  const sums = new Float64Array(seeds.length * 4);
  for (let iteration = 0; iteration < 4; iteration += 1) {
    sums.fill(0);
    accumulatePaletteSums(pixels, labs, palette, sums);
    const next = paletteFromSums(palette, sums);
    // Once the palette is identical, later iterations are provably identical
    // too, so the loop can stop without changing the result.
    const stable = palette.every(
      (color, index) =>
        color.l === next[index].l &&
        color.a === next[index].a &&
        color.b === next[index].b,
    );
    palette = next;
    if (stable) break;
  }
  return palette;
};

export const labelPixels = (
  pixels: Uint8ClampedArray,
  labs: PixelLabs,
  palette: PaletteColor[],
): Uint8Array => {
  const labL = labs.l;
  const labA = labs.a;
  const labB = labs.b;
  const occurrences = labs.occurrences;
  const k = palette.length;
  const labels = new Uint8Array(pixels.length / 4);
  const palL = new Float64Array(k);
  const palA = new Float64Array(k);
  const palB = new Float64Array(k);
  for (let candidate = 0; candidate < k; candidate += 1) {
    const color = palette[candidate];
    palL[candidate] = color.l;
    palA[candidate] = color.a;
    palB[candidate] = color.b;
  }
  for (let pixel = 0; pixel < labels.length; pixel += 1) {
    const index = pixel * 4;
    if (pixels[index + 3] < 8) {
      labels[pixel] = 255;
      continue;
    }
    if (occurrences && occurrences[pixel] < 0) {
      labels[pixel] = labels[-1 - occurrences[pixel]];
      continue;
    }
    const pl = labL[pixel];
    const pa = labA[pixel];
    const pb = labB[pixel];
    let closest = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (let candidate = 0; candidate < k; candidate += 1) {
      const dl = pl - palL[candidate];
      const da = pa - palA[candidate];
      const db = pb - palB[candidate];
      const candidateDistance = dl * dl + da * da + db * db;
      if (candidateDistance < closestDistance) {
        closestDistance = candidateDistance;
        closest = candidate;
      }
    }
    labels[pixel] = closest;
  }
  return labels;
};

export const findLabelComponents = (
  labels: Uint8Array,
  width: number,
  height: number,
): { components: LabelComponent[]; componentAt: Int32Array } => {
  const componentAt = new Int32Array(labels.length).fill(-1);
  const components: LabelComponent[] = [];
  const stack: number[] = [];
  for (let start = 0; start < labels.length; start += 1) {
    if (labels[start] === 255 || componentAt[start] >= 0) continue;
    const id = components.length;
    const label = labels[start];
    let area = 0;
    componentAt[start] = id;
    stack.push(start);
    while (stack.length > 0) {
      const pixel = stack.pop()!;
      area += 1;
      const x = pixel % width;
      const y = (pixel - x) / width;
      if (x > 0) {
        const neighbor = pixel - 1;
        if (componentAt[neighbor] < 0 && labels[neighbor] === label) {
          componentAt[neighbor] = id;
          stack.push(neighbor);
        }
      }
      if (x + 1 < width) {
        const neighbor = pixel + 1;
        if (componentAt[neighbor] < 0 && labels[neighbor] === label) {
          componentAt[neighbor] = id;
          stack.push(neighbor);
        }
      }
      if (y > 0) {
        const neighbor = pixel - width;
        if (componentAt[neighbor] < 0 && labels[neighbor] === label) {
          componentAt[neighbor] = id;
          stack.push(neighbor);
        }
      }
      if (y + 1 < height) {
        const neighbor = pixel + width;
        if (componentAt[neighbor] < 0 && labels[neighbor] === label) {
          componentAt[neighbor] = id;
          stack.push(neighbor);
        }
      }
    }
    components.push({
      id,
      label,
      area,
      neighbors: new Map(),
    });
  }
  const connect = (left: number, right: number) => {
    if (left < 0 || right < 0 || left === right) return;
    const leftNeighbors = components[left].neighbors;
    const rightNeighbors = components[right].neighbors;
    leftNeighbors.set(right, (leftNeighbors.get(right) ?? 0) + 1);
    rightNeighbors.set(left, (rightNeighbors.get(left) ?? 0) + 1);
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      if (x + 1 < width) connect(componentAt[pixel], componentAt[pixel + 1]);
      if (y + 1 < height)
        connect(componentAt[pixel], componentAt[pixel + width]);
    }
  }
  return { components, componentAt };
};

export const mergeComponentsToBudget = (
  labels: Uint8Array,
  width: number,
  height: number,
  palette: LabColor[],
  budget: number,
  minimumArea = 1,
): {
  labels: Uint8Array;
  initial: number;
  remaining: number;
  merged: number;
} => {
  const { components, componentAt } = findLabelComponents(
    labels,
    width,
    height,
  );
  const initial = components.length;
  if (initial <= budget && minimumArea <= 1)
    return { labels, initial, remaining: initial, merged: 0 };

  const parent = Int32Array.from(components, (component) => component.id);
  const find = (id: number): number => {
    let root = id;
    while (parent[root] !== root) root = parent[root];
    while (parent[id] !== id) {
      const next = parent[id];
      parent[id] = root;
      id = next;
    }
    return root;
  };
  let remaining = initial;
  const ordered = components
    .map((component) => component.id)
    .sort((left, right) => components[left].area - components[right].area);

  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of ordered) {
      const source = find(candidate);
      if (source !== candidate) continue;
      const sourceComponent = components[source];
      if (remaining <= budget && sourceComponent.area >= minimumArea) continue;
      const sourcePalette = palette[sourceComponent.label];
      // Single pass replaces the former entries[] -> map -> filter -> sort ->
      // [0] allocation chain. The comparator is identical: smallest perceptual
      // distance first, then widest shared boundary, then largest area, with
      // ties keeping the earliest neighbor (stable-sort order).
      let target = -1;
      let bestDifference = Number.POSITIVE_INFINITY;
      let bestBoundary = -1;
      let bestArea = -1;
      for (const [neighbor, boundary] of sourceComponent.neighbors) {
        const root = find(neighbor);
        if (root === source) continue;
        const colorDifference = distance(
          sourcePalette,
          palette[components[root].label],
        );
        const area = components[root].area;
        const better =
          target < 0 ||
          colorDifference < bestDifference ||
          (colorDifference === bestDifference &&
            (boundary > bestBoundary ||
              (boundary === bestBoundary && area > bestArea)));
        if (better) {
          target = root;
          bestDifference = colorDifference;
          bestBoundary = boundary;
          bestArea = area;
        }
      }
      if (target < 0) continue;
      parent[source] = target;
      components[target].area += sourceComponent.area;
      for (const [neighbor, boundary] of sourceComponent.neighbors) {
        const neighborRoot = find(neighbor);
        if (neighborRoot === target) continue;
        components[target].neighbors.set(
          neighborRoot,
          (components[target].neighbors.get(neighborRoot) ?? 0) + boundary,
        );
        components[neighborRoot].neighbors.set(
          target,
          (components[neighborRoot].neighbors.get(target) ?? 0) + boundary,
        );
      }
      remaining -= 1;
      changed = true;
    }
  }

  if (remaining === initial) return { labels, initial, remaining, merged: 0 };
  const mergedLabels = labels.slice();
  for (let pixel = 0; pixel < componentAt.length; pixel += 1) {
    if (componentAt[pixel] >= 0)
      mergedLabels[pixel] = components[find(componentAt[pixel])].label;
  }
  return {
    labels: mergedLabels,
    initial,
    remaining,
    merged: initial - remaining,
  };
};

const rgb = (color: PaletteColor): string =>
  `rgb(${Math.round(color.r)},${Math.round(color.g)},${Math.round(color.blue)})`;

const canonicalPaint = (shape: VectorShape): string =>
  `${shape.fill}|${shape.stroke}|${shape.strokeWidth}|${shape.opacity}|${shape.fillRule}`;

export const canonicalShape = (shape: VectorShape): string =>
  `${canonicalPaint(shape)}|${shape.subpaths.map((path) => `${path.closed}:${path.commands.map((command) => JSON.stringify(command)).join(",")}`).join(";")}`;

export const deduplicateShapes = (shapes: VectorShape[]): VectorShape[] => {
  const seenPaint = new Set<string>();
  const repeatedPaint = new Set<string>();
  for (const shape of shapes) {
    const paint = canonicalPaint(shape);
    if (seenPaint.has(paint)) repeatedPaint.add(paint);
    else seenPaint.add(paint);
  }
  if (repeatedPaint.size === 0) return shapes.slice();

  const buckets = new Map<number, string[]>();
  return shapes.filter((shape) => {
    if (!repeatedPaint.has(canonicalPaint(shape))) return true;
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

export interface ColorQuantization {
  palette: PaletteColor[];
  labels: Uint8Array;
}

/**
 * Optional dependency-injection seam for an alternate quantizer. When omitted,
 * quantizeColor runs in-process.
 */
export type ColorQuantizer = (
  pixels: Uint8ClampedArray,
  seeds: PaletteColor[],
) => ColorQuantization;

export const colorSeeds = (
  pixels: Uint8ClampedArray,
  options: WorkerConversionOptions,
): PaletteColor[] =>
  paletteSeeds(
    pixels,
    Math.max(2, Math.min(MAX_PALETTE_COLORS, Math.round(options.colorSteps))),
    options.fillStrategy,
  );

export const quantizeColor = (
  pixels: Uint8ClampedArray,
  seeds: PaletteColor[],
): ColorQuantization => {
  const labs = precomputePixelLabs(pixels);
  const palette = refinePalette(pixels, labs, seeds);
  return { palette, labels: labelPixels(pixels, labs, palette) };
};

/**
 * Everything after quantization: component-budget merging, boundary tracing,
 * ring simplification, curve fitting, deduplication, and diagnostics. Taking
 * labels and palette as arguments lets the quantizer run elsewhere (for
 * example, split across parallel workers).
 */
export const assembleColorDocument = (
  initialLabels: Uint8Array,
  palette: PaletteColor[],
  width: number,
  height: number,
  options: WorkerConversionOptions,
): VectorDocument => {
  const componentMerge = mergeComponentsToBudget(
    initialLabels,
    width,
    height,
    palette,
    Math.max(1, options.maxPaths),
    Math.max(1, options.turdSize),
  );
  const labels = componentMerge.labels;
  const boundaries = traceColorBoundaries(
    labels,
    width,
    height,
    palette.length,
  );
  const fitBoundary = createSharedBoundaryFitter(
    labels,
    width,
    height,
    options.optCurve,
    options.optTolerance,
  );
  const indexed = palette
    .map((color, index) => ({ color, index }))
    .sort((left, right) => right.color.count - left.color.count);
  const shapes: VectorShape[] = [];
  indexed.forEach(({ color, index }) => {
    const rings = boundaries[index]
      .map((points) => ({
        points,
        area: Math.abs(ringArea(points)),
      }))
      .sort((left, right) => right.area - left.area);
    if (rings.length === 0) return;
    shapes.push({
      id: `color-${index}`,
      fill: rgb(color),
      stroke: "none",
      strokeWidth: 0,
      opacity: 1,
      fillRule: "evenodd",
      subpaths: rings.map((ring) => fitBoundary(ring.points)),
    });
  });
  const deduplicated = deduplicateShapes(shapes);
  const outputPaths = deduplicated.reduce(
    (sum, shape) => sum + shape.subpaths.length,
    0,
  );
  const pathBudgetExceeded = outputPaths > options.maxPaths;
  return {
    version: 1,
    width,
    height,
    mode: "color",
    shapes: deduplicated,
    diagnostics: {
      requestedMaxPaths: options.maxPaths,
      outputPaths,
      pathBudgetExceeded,
      initialColorComponents: componentMerge.initial,
      mergedColorComponents: componentMerge.remaining,
      mergedComponents: componentMerge.merged,
      warnings: pathBudgetExceeded
        ? [
            `Path budget could not be reached without dropping disconnected artwork (${outputPaths} paths for a ${options.maxPaths} path target).`,
          ]
        : [],
    },
  };
};

export const traceColorDocument = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: WorkerConversionOptions,
  quantize?: ColorQuantizer,
): VectorDocument => {
  const seeds = colorSeeds(pixels, options);
  const quantization = quantize
    ? quantize(pixels, seeds)
    : quantizeColor(pixels, seeds);
  return assembleColorDocument(
    quantization.labels,
    quantization.palette,
    width,
    height,
    options,
  );
};
