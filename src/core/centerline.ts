import { pointsToSubpath, simplifyOpen, type Point } from "./geometry";
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

const luminance = (r: number, g: number, b: number): number =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;

const createBinaryMask = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: WorkerConversionOptions,
): Uint8Array => {
  const mask = new Uint8Array(width * height);
  const lightForeground = options.invert || !options.blackOnWhite;
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 4;
    const alpha = pixels[offset + 3] / 255;
    const value = luminance(
      pixels[offset] * alpha + 255 * (1 - alpha),
      pixels[offset + 1] * alpha + 255 * (1 - alpha),
      pixels[offset + 2] * alpha + 255 * (1 - alpha),
    );
    mask[index] = lightForeground
      ? Number(value >= options.threshold)
      : Number(value < options.threshold);
  }
  return mask;
};

const transitions = (
  mask: Uint8Array,
  x: number,
  y: number,
  width: number,
): number => {
  const values = NEIGHBORS.map(([dx, dy]) => mask[(y + dy) * width + x + dx]);
  let count = 0;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === 0 && values[(index + 1) % values.length] === 1)
      count += 1;
  }
  return count;
};

export const thinBinaryMask = (
  input: Uint8Array,
  width: number,
  height: number,
): Uint8Array => {
  const mask = new Uint8Array(input);
  let changed = true;
  while (changed) {
    changed = false;
    for (const secondPass of [false, true]) {
      const remove: number[] = [];
      for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
          const index = y * width + x;
          if (mask[index] === 0) continue;
          const p2 = mask[(y - 1) * width + x];
          const p4 = mask[y * width + x + 1];
          const p6 = mask[(y + 1) * width + x];
          const p8 = mask[y * width + x - 1];
          const neighborCount = NEIGHBORS.reduce(
            (sum, [dx, dy]) => sum + mask[(y + dy) * width + x + dx],
            0,
          );
          if (
            neighborCount < 2 ||
            neighborCount > 6 ||
            transitions(mask, x, y, width) !== 1
          )
            continue;
          const firstConstraint = secondPass ? p2 * p4 * p8 : p2 * p4 * p6;
          const secondConstraint = secondPass ? p2 * p6 * p8 : p4 * p6 * p8;
          if (firstConstraint === 0 && secondConstraint === 0)
            remove.push(index);
        }
      }
      if (remove.length > 0) {
        changed = true;
        for (const index of remove) mask[index] = 0;
      }
    }
  }
  return mask;
};

const edgeKey = (a: number, b: number): string =>
  a < b ? `${a}:${b}` : `${b}:${a}`;

const graphNeighbors = (
  mask: Uint8Array,
  index: number,
  width: number,
  height: number,
): number[] => {
  const x = index % width;
  const y = Math.floor(index / width);
  const result: number[] = [];
  for (const [dx, dy] of NEIGHBORS) {
    const nx = x + dx;
    const ny = y + dy;
    if (
      nx >= 0 &&
      ny >= 0 &&
      nx < width &&
      ny < height &&
      mask[ny * width + nx] === 1
    ) {
      if (
        dx !== 0 &&
        dy !== 0 &&
        (mask[y * width + nx] === 1 || mask[ny * width + x] === 1)
      )
        continue;
      result.push(ny * width + nx);
    }
  }
  return result;
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
): { subpaths: VectorSubpath[]; stats: CenterlineGraphStats } => {
  const pixels: number[] = [];
  const neighbors = new Map<number, number[]>();
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] === 0) continue;
    pixels.push(index);
    neighbors.set(index, graphNeighbors(mask, index, width, height));
  }
  const nodes = pixels.filter(
    (index) => (neighbors.get(index)?.length ?? 0) !== 2,
  );
  const visited = new Set<string>();
  const chains: { indices: number[]; closed: boolean }[] = [];

  const follow = (start: number, next: number): number[] => {
    const chain = [start, next];
    visited.add(edgeKey(start, next));
    let previous = start;
    let current = next;
    while ((neighbors.get(current)?.length ?? 0) === 2) {
      const candidate = neighbors
        .get(current)
        ?.find((value) => value !== previous);
      if (candidate === undefined || visited.has(edgeKey(current, candidate)))
        break;
      chain.push(candidate);
      visited.add(edgeKey(current, candidate));
      previous = current;
      current = candidate;
    }
    return chain;
  };

  for (const node of nodes) {
    for (const next of neighbors.get(node) ?? []) {
      if (!visited.has(edgeKey(node, next)))
        chains.push({ indices: follow(node, next), closed: false });
    }
  }

  let cycles = 0;
  for (const start of pixels) {
    const next = (neighbors.get(start) ?? []).find(
      (value) => !visited.has(edgeKey(start, value)),
    );
    if (next === undefined) continue;
    const indices = follow(start, next);
    if (indices[indices.length - 1] !== start) indices.push(start);
    chains.push({ indices, closed: true });
    cycles += 1;
  }

  const subpaths = chains
    .filter(({ indices }) => indices.length >= 2)
    .map(({ indices, closed }) => {
      const points: Point[] = indices.map((index) => ({
        x: (index % width) + 0.5,
        y: Math.floor(index / width) + 0.5,
      }));
      const simplified = simplifyOpen(points, tolerance);
      return pointsToSubpath(simplified, closed);
    });

  return {
    subpaths,
    stats: {
      endpoints: nodes.filter(
        (index) => (neighbors.get(index)?.length ?? 0) === 1,
      ).length,
      junctions: nodes.filter(
        (index) => (neighbors.get(index)?.length ?? 0) > 2,
      ).length,
      cycles,
    },
  };
};

export const traceCenterlines = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: WorkerConversionOptions,
): VectorDocument => {
  const thinned = thinBinaryMask(
    createBinaryMask(pixels, width, height, options),
    width,
    height,
  );
  const { subpaths } = walkSkeleton(thinned, width, height);
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
