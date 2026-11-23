import { fitPointsToSubpath } from "./curveFit";
import {
  exceedsChordTolerance,
  pointsToSubpath,
  simplifyOpen,
  type Point,
} from "./geometry";
import type { VectorCommand, VectorSubpath } from "./vectorDocument";

type Segment = Extract<VectorCommand, { type: "L" | "C" }>;

const ringPointAt = (ring: Point[], index: number): Point =>
  ring[index < ring.length ? index : index - ring.length];

export const createSharedBoundaryFitter = (
  labels: Uint8Array,
  width: number,
  height: number,
  fitCurves: boolean,
  tolerance: number,
) => {
  const keyOf = ({ x, y }: Point) => y * (width + 1) + x;
  // Two bits per lattice vertex for unknown, ordinary, or junction.
  const junctions = new Uint8Array(Math.ceil(((width + 1) * (height + 1)) / 4));
  const labelAt = (x: number, y: number) =>
    x < 0 || y < 0 || x >= width || y >= height ? 255 : labels[y * width + x];
  const isJunction = ({ x, y }: Point, key: number) => {
    const slot = key >>> 2;
    const shift = (key & 3) << 1;
    const cached = (junctions[slot] >>> shift) & 3;
    if (cached) return cached === 2;
    const nw = labelAt(x - 1, y - 1);
    const ne = labelAt(x, y - 1);
    const se = labelAt(x, y);
    const sw = labelAt(x - 1, y);
    const degree =
      Number(nw !== ne) +
      Number(ne !== se) +
      Number(se !== sw) +
      Number(sw !== nw);
    // A diagonal contact has degree four and must keep its original pairing.
    // Keep the four image corners fixed even when the frame is one long run.
    const junction =
      degree !== 2 || ((x === 0 || x === width) && (y === 0 || y === height));
    junctions[slot] |= (junction ? 2 : 1) << shift;
    return junction;
  };
  const fitted = new Map<number, { forward: Segment[]; backward: Segment[] }>();
  // Keep fitted chains close to their grid edges. Split the budget between
  // simplification and fitting, since both may displace an edge.
  const error = Math.max(0.01, Math.min(0.45, tolerance));
  const appendChain = (
    ring: Point[],
    startIndex: number,
    endIndex: number,
    output: VectorCommand[],
  ) => {
    const firstPoint = ring[startIndex];
    const lastPoint = ringPointAt(ring, endIndex);
    if (endIndex === startIndex + 1) {
      // A single lattice edge is already exact in both directions.
      output.push({ type: "L", x: lastPoint.x, y: lastPoint.y });
      return;
    }
    const first = keyOf(firstPoint);
    const last = keyOf(lastPoint);
    const reverse =
      first === last
        ? keyOf(ringPointAt(ring, startIndex + 1)) >
          keyOf(ringPointAt(ring, endIndex - 1))
        : first > last;
    const start = reverse ? last : first;
    const next = keyOf(
      ringPointAt(ring, reverse ? endIndex - 1 : startIndex + 1),
    );
    const direction =
      next === start + 1 ? 0 : next > start ? 1 : next === start - 1 ? 2 : 3;
    const key = start * 4 + direction;
    let pair = fitted.get(key);
    if (!pair) {
      // The second side needs the cached commands only. Materialize points
      // in fitting order on the first visit, including rings that wrap.
      const ordered = new Array<Point>(endIndex - startIndex + 1);
      for (let index = 0; index < ordered.length; index += 1)
        ordered[index] = ringPointAt(
          ring,
          reverse ? endIndex - index : startIndex + index,
        );
      const tolerance = fitCurves ? error / 2 : error;
      const eligible = fitCurves && ordered.length > 4;
      // The fitted path uses the source chain. Only its first simplification
      // split matters when deciding whether to keep the edge linear.
      const fit = eligible && exceedsChordTolerance(ordered, tolerance);
      // Straight edges stay linear, including frame edges. At either end of
      // a curved chain keep the original unit edge as a junction tangent.
      const path = fit
        ? fitPointsToSubpath(ordered.slice(1, -1), false, tolerance)
        : pointsToSubpath(
            eligible
              ? [ordered[0], ordered[ordered.length - 1]]
              : simplifyOpen(ordered, tolerance),
            false,
          );
      const forward = path.commands.slice(1) as Segment[];
      if (fit) {
        forward.unshift({ type: "L", ...ordered[1] });
        forward.push({ type: "L", ...ordered[ordered.length - 1] });
      }
      const backward = forward
        .map((command, index): Segment => {
          const end = index === 0 ? ordered[0] : forward[index - 1];
          return command.type === "L"
            ? { type: "L", x: end.x, y: end.y }
            : {
                type: "C",
                x1: command.x2,
                y1: command.y2,
                x2: command.x1,
                y2: command.y1,
                x: end.x,
                y: end.y,
              };
        })
        .reverse();
      pair = { forward, backward };
      fitted.set(key, pair);
    }
    for (const command of reverse ? pair.backward : pair.forward)
      output.push(command);
  };

  return (ring: Point[]): VectorSubpath => {
    const cuts: number[] = [];
    let minimum = 0;
    let minimumKey = keyOf(ring[0]);
    for (let index = 0; index < ring.length; index += 1) {
      const key = keyOf(ring[index]);
      if (isJunction(ring[index], key)) cuts.push(index);
      if (key < minimumKey) {
        minimum = index;
        minimumKey = key;
      }
    }
    if (cuts.length === 0) cuts.push(minimum);
    const commands: VectorCommand[] = [{ type: "M", ...ring[cuts[0]] }];
    for (let index = 0; index < cuts.length; index += 1) {
      const start = cuts[index];
      const end = cuts[index + 1] ?? cuts[0] + ring.length;
      appendChain(ring, start, end, commands);
    }
    commands.push({ type: "Z" });
    return { commands, closed: true };
  };
};
