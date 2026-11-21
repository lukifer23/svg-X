import type { Point } from "./geometry";

const MIN_DIAMETER = 32;
const MAX_DIAMETER = 256;
const reverse = (direction: number) => (direction + 4) % 8;
const firstDirection = (bits: number) => 31 - Math.clz32(bits & -bits);

const isCircularOutline = (
  cycle: number[],
  width: number,
  graph: Uint8Array,
  degree: Uint8Array,
) => {
  if (cycle.length < 2 * MIN_DIAMETER) return false;
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  let area = 0;
  let junctions = 0;
  let previous = cycle[cycle.length - 1];
  for (const pixel of cycle) {
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    area += (previous % width) * y - x * Math.floor(previous / width);
    previous = pixel;
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
    junctions += Number(degree[graph[pixel]] > 2);
  }
  const diameterX = right - left;
  const diameterY = bottom - top;
  if (
    area <= 0 ||
    junctions < 2 ||
    Math.min(diameterX, diameterY) < MIN_DIAMETER ||
    Math.max(diameterX, diameterY) > MAX_DIAMETER ||
    Math.abs(diameterX - diameterY) > 0.12 * Math.max(diameterX, diameterY)
  )
    return false;

  const center: Point = { x: (left + right) / 2, y: (top + bottom) / 2 };
  const radius = (diameterX + diameterY) / 4;
  const tolerance = Math.max(2, 0.08 * radius);
  const inner = (radius - tolerance) ** 2;
  const outer = (radius + tolerance) ** 2;
  return cycle.every((pixel) => {
    const square =
      ((pixel % width) - center.x) ** 2 +
      (Math.floor(pixel / width) - center.y) ** 2;
    return square >= inner && square <= outer;
  });
};

// Every returned edge already exists in the skeleton. Peel open tails for
// face discovery only, then follow the plane graph in clockwise edge order.
export const findCircularPerimeters = (
  graph: Uint8Array,
  pixels: number[],
  width: number,
  offsets: number[],
  degree: Uint8Array,
): number[][] => {
  if (pixels.length < 2 * MIN_DIAMETER) return [];
  const core = graph.slice();
  const leaves = pixels.filter((pixel) => degree[core[pixel]] === 1);
  for (let head = 0; head < leaves.length; head += 1) {
    const pixel = leaves[head];
    if (degree[core[pixel]] !== 1) continue;
    const direction = firstDirection(core[pixel]);
    const neighbor = pixel + offsets[direction];
    core[pixel] = 0;
    core[neighbor] &= ~(1 << reverse(direction));
    if (degree[core[neighbor]] === 1) leaves.push(neighbor);
  }

  const seen = new Uint8Array(graph.length);
  const rings: number[][] = [];
  for (const start of pixels) {
    let unvisited = core[start] & ~seen[start];
    while (unvisited) {
      let direction = firstDirection(unvisited);
      let current = start;
      const face: number[] = [];
      do {
        face.push(current);
        seen[current] |= 1 << direction;
        current += offsets[direction];
        const back = reverse(direction);
        const neighbors = core[current];
        // Rotate immediately past the incoming edge to keep the face on
        // the same side, even where the perimeter meets another stroke.
        const rotated = (neighbors >> (back + 1)) | (neighbors << (7 - back));
        direction = (firstDirection(rotated & 255) + back + 1) % 8;
      } while (!(seen[current] & (1 << direction)));

      if (face.length >= 2 * MIN_DIAMETER) {
        const chain: number[] = [];
        const positions = new Map<number, number>();
        // A face can revisit a cut vertex when it walks out to a small
        // attached loop. Split that excursion away from the outline.
        face.push(face[0]);
        for (const pixel of face) {
          const visit = positions.get(pixel);
          if (visit === undefined) {
            positions.set(pixel, chain.length);
            chain.push(pixel);
            continue;
          }
          if (chain.length - visit >= 2 * MIN_DIAMETER) {
            const cycle = chain.slice(visit);
            if (isCircularOutline(cycle, width, graph, degree))
              rings.push(cycle);
          }
          for (let index = visit + 1; index < chain.length; index += 1)
            positions.delete(chain[index]);
          chain.length = visit + 1;
        }
      }
      unvisited = core[start] & ~seen[start];
    }
  }
  return rings;
};
