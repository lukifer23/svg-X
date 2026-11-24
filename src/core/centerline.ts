import { findCircularPerimeters } from "./circularPerimeters";
import { recoverCircularStrokes } from "./circularStrokeRecovery";
import { fitPointsToSubpath } from "./curveFit";
import { repairFadedCurves } from "./fadedCurveRepair";
import {
  pointsToSubpath,
  simplifyOpen,
  simplifyRing,
  type Point,
} from "./geometry";
import { traceScanInk, type ScanInkEvidence } from "./scanLighting";
import type {
  VectorDocument,
  VectorSubpath,
  WorkerConversionOptions,
} from "./vectorDocument";

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
];

const DEGREE = Uint8Array.from({ length: 256 }, (_, bits) => {
  let count = 0;
  for (; bits; bits &= bits - 1) count += 1;
  return count;
});

const firstDirection = (bits: number) => 31 - Math.clz32(bits & -bits);

const THIN_RULES = Uint8Array.from(DEGREE, (degree, bits) => {
  if (degree < 2 || degree > 6) return 0;
  let topology = bits;
  for (const diagonal of [0, 2, 4, 6]) {
    const adjacent = (1 << ((diagonal + 7) % 8)) | (1 << (diagonal + 1));
    if (bits & adjacent) topology &= ~(1 << diagonal);
  }
  // A one-pixel branch can look like a wide end under eight-neighbor counting.
  const endpoint =
    DEGREE[topology] === 1 ? 4 | (firstDirection(topology) << 3) : 0;
  const rotated = (bits >> 1) | ((bits & 1) << 7);
  if (DEGREE[~bits & rotated & 255] !== 1) return 0;
  const includes = (required: number) => (bits & required) === required;
  // Zhang-Suen cardinal-neighbor triplets, one bit for each subiteration.
  const first = !includes(42) && !includes(168);
  const second = !includes(138) && !includes(162);
  return Number(first) | (Number(second) << 1) | endpoint;
});

const luminance = (r: number, g: number, b: number): number =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;

type TipSupport = (pixel: number, direction: number) => boolean;

const createBinaryMask = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: WorkerConversionOptions,
): { mask: Uint8Array; strongInk?: Uint8Array; evidence?: ScanInkEvidence } => {
  const lightForeground = options.invert || !options.blackOnWhite;
  if (options.normalizeScanLighting) {
    const tones = new Uint8Array(width * height);
    for (let index = 0; index < tones.length; index += 1) {
      const offset = index * 4;
      const alpha = pixels[offset + 3] / 255;
      const value =
        255 * (1 - alpha) +
        luminance(pixels[offset], pixels[offset + 1], pixels[offset + 2]) *
          alpha;
      tones[index] = Math.round(lightForeground ? 255 - value : value);
    }
    return traceScanInk(
      tones,
      width,
      height,
      lightForeground ? 255 - options.threshold : options.threshold,
      options.turdSize >= 1,
    );
  }
  const mask = new Uint8Array(width * height);
  const strongInk =
    options.turdSize >= 1 ? new Uint8Array(mask.length) : undefined;
  const cutoff = lightForeground
    ? 255 - (255 - options.threshold) * 0.35
    : options.threshold * 0.35;
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 4;
    const opacity = pixels[offset + 3];
    const alpha = opacity / 255;
    const matte = 255 * (1 - alpha);
    const value =
      opacity === 255
        ? luminance(pixels[offset], pixels[offset + 1], pixels[offset + 2])
        : luminance(
            pixels[offset] * alpha + matte,
            pixels[offset + 1] * alpha + matte,
            pixels[offset + 2] * alpha + matte,
          );
    mask[index] = lightForeground
      ? Number(value >= options.threshold)
      : Number(value < options.threshold);
    if (strongInk && mask[index])
      strongInk[index] = Number(
        lightForeground ? value > cutoff : value < cutoff,
      );
  }
  return { mask, strongInk };
};

export const thinBinaryMask = (
  input: Uint8Array,
  inputWidth: number,
  inputHeight: number,
  preserveShortTips: boolean | TipSupport = true,
): Uint8Array => {
  // A zero border lets the same thinning rules apply to cropped artwork.
  const width = inputWidth + 2;
  const height = inputHeight + 2;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < inputHeight; y += 1)
    mask.set(
      input.subarray(y * inputWidth, (y + 1) * inputWidth),
      (y + 1) * width + 1,
    );
  // The scan may contain long blank runs between strokes. Visit only
  // foreground pixels and apply each subiteration's deletions together.
  const foreground: number[] = [];
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    for (let x = 1; x < width - 1; x += 1)
      if (mask[row + x]) foreground.push(row + x);
  }
  const remove: number[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const pass of [1, 2]) {
      remove.length = 0;
      for (const index of foreground) {
        if (mask[index] === 0) continue;
        const bits =
          mask[index - width - 1] |
          (mask[index - width] << 1) |
          (mask[index - width + 1] << 2) |
          (mask[index + 1] << 3) |
          (mask[index + width + 1] << 4) |
          (mask[index + width] << 5) |
          (mask[index + width - 1] << 6) |
          (mask[index - 1] << 7);
        const rule = THIN_RULES[bits];
        if (!(rule & pass)) continue;
        if (
          rule & 4 &&
          (preserveShortTips === true ||
            (preserveShortTips &&
              preserveShortTips(
                (Math.floor(index / width) - 1) * inputWidth +
                  (index % width) -
                  1,
                rule >> 3,
              )))
        )
          continue;
        remove.push(index);
      }
      if (remove.length > 0) {
        changed = true;
        for (const index of remove) mask[index] = 0;
      }
    }
  }
  const result = new Uint8Array(input.length);
  for (let y = 0; y < inputHeight; y += 1) {
    const start = (y + 1) * width + 1;
    result.set(mask.subarray(start, start + inputWidth), y * inputWidth);
  }
  return result;
};

const neighborBits = (
  mask: Uint8Array,
  index: number,
  width: number,
  height: number,
  skipCornerShortcuts: boolean,
): number => {
  const x = index % width;
  const y = Math.floor(index / width);
  let result = 0;
  for (let direction = 0; direction < NEIGHBORS.length; direction += 1) {
    const [dx, dy] = NEIGHBORS[direction];
    const nx = x + dx;
    const ny = y + dy;
    if (
      nx >= 0 &&
      ny >= 0 &&
      nx < width &&
      ny < height &&
      mask[ny * width + nx] !== 0
    ) {
      if (
        skipCornerShortcuts &&
        dx !== 0 &&
        dy !== 0 &&
        (mask[y * width + nx] === 1 || mask[ny * width + x] === 1)
      )
        continue;
      result |= 1 << direction;
    }
  }
  return result;
};

// Scan grain is removed in raster space. Its pixel area is meaningful before
// thinning, which can collapse specks and short intentional details alike.
const suppressIsolatedMarks = (
  mask: Uint8Array,
  width: number,
  height: number,
  size: number,
  strongInk: Uint8Array,
) => {
  const stride = width + 2;
  const padded = new Uint8Array(stride * (height + 2));
  for (let y = 0; y < height; y += 1)
    padded.set(mask.subarray(y * width, (y + 1) * width), (y + 1) * stride + 1);
  const offsets = [
    1,
    -1,
    stride,
    -stride,
    stride + 1,
    stride - 1,
    -stride + 1,
    -stride - 1,
  ];
  const onlyNeighbor = (index: number, except: number) => {
    let found = -1;
    for (const offset of offsets) {
      const next = index + offset;
      if (next === except || !padded[next]) continue;
      if (found >= 0) return -2;
      found = next;
    }
    return found;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      if (!mask[pixel] || strongInk[pixel]) continue;
      const paddedIndex = (y + 1) * stride + x + 1;
      const next = onlyNeighbor(paddedIndex, -1);
      if (next === -1) mask[pixel] = padded[paddedIndex] = 0;
      if (next < 0 || size < 2 || onlyNeighbor(next, paddedIndex) !== -1)
        continue;
      const partner =
        (Math.floor(next / stride) - 1) * width + (next % stride) - 1;
      if (strongInk[partner]) continue;
      mask[pixel] = mask[partner] = padded[paddedIndex] = padded[next] = 0;
    }
  }
};

const suppressSpecks = (
  mask: Uint8Array,
  width: number,
  height: number,
  size: number,
  strongInk: Uint8Array,
) => {
  // The default only considers single pixels and isolated pairs. Checking
  // local connectivity avoids visiting every pixel of large ink components.
  if (size < 3) {
    suppressIsolatedMarks(mask, width, height, size, strongInk);
    return;
  }
  const visited = new Uint8Array(mask.length);
  const queue: number[] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    queue.length = 0;
    queue.push(start);
    visited[start] = 1;
    for (let index = 0; index < queue.length; index += 1) {
      const pixel = queue[index];
      const x = pixel % width;
      const y = (pixel - x) / width;
      const left = Math.max(0, x - 1);
      const right = Math.min(width - 1, x + 1);
      for (
        let row = Math.max(0, y - 1);
        row <= Math.min(height - 1, y + 1);
        row += 1
      ) {
        for (
          let next = row * width + left;
          next <= row * width + right;
          next += 1
        ) {
          if (!mask[next] || visited[next]) continue;
          visited[next] = 1;
          queue.push(next);
        }
      }
    }
    if (queue.length > size) continue;
    if (!queue.some((pixel) => strongInk[pixel]))
      for (const pixel of queue) mask[pixel] = 0;
  }
};

export interface CenterlineGraphStats {
  endpoints: number;
  junctions: number;
  cycles: number;
}

export const walkSkeleton = (
  mask: Uint8Array,
  width: number,
  height: number,
  tolerance = 0.6,
  fitCurves = false,
  curveError = tolerance,
  maximumSpurLength = 0,
  supportsTip?: TipSupport,
  preserveCircularOutlines = false,
): { subpaths: VectorSubpath[]; stats: CenterlineGraphStats } => {
  const pixels: number[] = [];
  const graph = new Uint8Array(mask.length);
  const offsets = NEIGHBORS.map(([dx, dy]) => dy * width + dx);
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] === 0) continue;
    pixels.push(index);
    graph[index] = neighborBits(mask, index, width, height, true);
  }
  if (maximumSpurLength > 0) {
    const spurs = new Map<number, Array<Array<[number, number]>>>();
    for (const tip of pixels) {
      if (DEGREE[graph[tip]] !== 1) continue;
      let current = tip;
      const tipDirection = firstDirection(graph[tip]);
      let direction = tipDirection;
      let length = 0;
      const edges: Array<[number, number]> = [];
      while (length < maximumSpurLength) {
        length += direction % 2 === 0 ? Math.SQRT2 : 1;
        if (length > maximumSpurLength) break;
        edges.push([current, direction]);
        current += offsets[direction];
        const degree = DEGREE[graph[current]];
        if (degree > 2 && !supportsTip?.(tip, tipDirection)) {
          const candidates = spurs.get(current) ?? [];
          candidates.push(edges);
          spurs.set(current, candidates);
        }
        if (degree !== 2) break;
        direction = firstDirection(
          graph[current] & ~(1 << ((direction + 4) % 8)),
        );
      }
    }
    for (const [junction, candidates] of spurs) {
      // Keep compact stars and real short detached strokes intact. Remove
      // short tips only where at least two continuing branches survive.
      if (DEGREE[graph[junction]] - candidates.length < 2) continue;
      for (const edges of candidates) {
        for (const [pixel, direction] of edges) {
          graph[pixel] &= ~(1 << direction);
          graph[pixel + offsets[direction]] &= ~(1 << ((direction + 4) % 8));
        }
      }
    }
  }

  const remaining = graph.slice();
  const subpaths: VectorSubpath[] = [];
  const parents = new Map<number, number>();
  const root = (node: number): number => {
    while (parents.has(node)) {
      const parent = parents.get(node)!;
      const grandparent = parents.get(parent);
      if (grandparent !== undefined) parents.set(node, grandparent);
      node = parent;
    }
    return node;
  };
  let cycles = 0;
  const point = (index: number): Point => ({
    x: (index % width) + 0.5,
    y: Math.floor(index / width) + 0.5,
  });
  if (preserveCircularOutlines) {
    for (const ring of findCircularPerimeters(
      graph,
      pixels,
      width,
      offsets,
      DEGREE,
    )) {
      const directions = ring.map((pixel, index) =>
        offsets.indexOf(ring[(index + 1) % ring.length] - pixel),
      );
      if (
        ring.some(
          (pixel, index) => !(remaining[pixel] & (1 << directions[index])),
        )
      )
        continue;
      const start = root(ring[0]);
      for (const [index, pixel] of ring.entries()) {
        const direction = directions[index];
        remaining[pixel] &= ~(1 << direction);
        remaining[pixel + offsets[direction]] &= ~(1 << ((direction + 4) % 8));
        const branch = root(pixel);
        if (DEGREE[graph[pixel]] > 2 && branch !== start)
          parents.set(branch, start);
      }
      cycles += 1;
      const geometry = simplifyRing(
        ring.map(point),
        fitCurves ? tolerance / 2 : tolerance,
      );
      subpaths.push(
        fitCurves
          ? fitPointsToSubpath(geometry, true, Math.max(0.01, curveError / 2))
          : pointsToSubpath(geometry, true),
      );
    }
  }
  const follow = (start: number) => {
    const points = [point(start)];
    let current = start;
    do {
      const direction = firstDirection(remaining[current]);
      remaining[current] &= ~(1 << direction);
      current += offsets[direction];
      remaining[current] &= ~(1 << ((direction + 4) % 8));
      points.push(point(current));
    } while (DEGREE[graph[current]] === 2 && remaining[current]);

    const startRoot = root(start);
    const endRoot = root(current);
    if (startRoot === endRoot) cycles += 1;
    else parents.set(startRoot, endRoot);

    const closed = current === start;
    // Keep the original anchor when a loop is attached to a junction. A
    // repeated terminal point passed to the cubic fitter corrupts its tangent.
    const simplified = simplifyOpen(
      points,
      fitCurves ? tolerance / 2 : tolerance,
    );
    let geometry = closed ? simplified.slice(0, -1) : simplified;
    if (closed && geometry.length < 3) geometry = points.slice(0, -1);
    subpaths.push(
      fitCurves
        ? fitPointsToSubpath(geometry, closed, Math.max(0.01, curveError / 2))
        : pointsToSubpath(geometry, closed),
    );
  };
  let endpoints = 0;
  let junctions = 0;
  for (const index of pixels) {
    const degree = DEGREE[graph[index]];
    if (degree === 1) endpoints += 1;
    if (degree > 2) junctions += 1;
    if (degree === 2) continue;
    while (remaining[index]) follow(index);
  }
  for (const index of pixels) if (remaining[index]) follow(index);
  return {
    subpaths,
    stats: { endpoints, junctions, cycles },
  };
};

export const traceCenterlines = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: WorkerConversionOptions,
  repairGuide?: Uint8Array,
): VectorDocument => {
  if (
    repairGuide &&
    (repairGuide.length !== width * height || !options.normalizeScanLighting)
  )
    throw new Error(
      "A repair guide requires scan lighting and matching grayscale dimensions",
    );
  const { mask, strongInk, evidence } = createBinaryMask(
    pixels,
    width,
    height,
    options,
  );
  if (strongInk)
    suppressSpecks(mask, width, height, options.turdSize, strongInk);
  const supportsTip: TipSupport | undefined =
    strongInk &&
    ((pixel, direction) => {
      if (!strongInk[pixel]) return false;
      const x = pixel % width;
      const y = (pixel - x) / width;
      const [dx, dy] = NEIGHBORS[(direction + 2) % 8];
      // Reject dark spurs inside a broad ink mass using the original raster.
      if (
        x - dx < 0 ||
        x - dx >= width ||
        x + dx < 0 ||
        x + dx >= width ||
        y - dy < 0 ||
        y - dy >= height ||
        y + dy < 0 ||
        y + dy >= height
      )
        return true;
      const across = dy * width + dx;
      return !mask[pixel - across] || !mask[pixel + across];
    });
  const thinned = thinBinaryMask(mask, width, height, supportsTip ?? true);
  if (evidence)
    repairFadedCurves(thinned, width, height, evidence, (index) =>
      neighborBits(thinned, index, width, height, true),
    );
  // A loose tolerance stored for Potrace must not let two nearby
  // centerlines cross or let a narrow loop collapse.
  const tolerance = Math.max(0.05, Math.min(0.45, options.optTolerance));
  const recoveredRings = evidence
    ? recoverCircularStrokes(thinned, width, height, evidence, (index) =>
        neighborBits(thinned, index, width, height, true),
      )
    : [];
  if (evidence && repairGuide)
    repairFadedCurves(
      thinned,
      width,
      height,
      evidence,
      (index) => neighborBits(thinned, index, width, height, true),
      repairGuide,
    );
  const { subpaths } = walkSkeleton(
    thinned,
    width,
    height,
    tolerance,
    options.optCurve,
    tolerance,
    Math.min(4, options.turdSize),
    supportsTip,
    evidence !== undefined,
  );
  for (const ring of recoveredRings) {
    const geometry = simplifyRing(
      ring,
      options.optCurve ? tolerance / 2 : tolerance,
    );
    subpaths.push(
      options.optCurve
        ? fitPointsToSubpath(geometry, true, tolerance / 2)
        : pointsToSubpath(geometry, true),
    );
  }
  const background =
    options.backgroundColor === "transparent"
      ? []
      : [
          {
            id: "centerline-background",
            fill: options.backgroundColor,
            stroke: "none",
            strokeWidth: 0,
            opacity: 1,
            fillRule: "nonzero" as const,
            subpaths: [
              {
                closed: true,
                commands: [
                  { type: "M" as const, x: 0, y: 0 },
                  { type: "L" as const, x: width, y: 0 },
                  { type: "L" as const, x: width, y: height },
                  { type: "L" as const, x: 0, y: height },
                  { type: "Z" as const },
                ],
              },
            ],
          },
        ];
  return {
    version: 1,
    width,
    height,
    mode: "centerline",
    shapes: [
      ...background,
      ...(subpaths.length === 0
        ? []
        : [
            {
              id: "centerline-foreground",
              fill: "none",
              stroke: options.foregroundColor,
              strokeWidth: Math.max(0.1, options.strokeWidth),
              opacity: 1,
              fillRule: "nonzero" as const,
              subpaths,
            },
          ]),
    ],
  };
};
