import { fitPointsToSubpath } from "./curveFit";
import { pointsToSubpath, simplifyOpen, type Point } from "./geometry";
import type { VectorCommand, VectorSubpath } from "./vectorDocument";

type Segment = Extract<VectorCommand, { type: "L" | "C" }>;

export const createSharedBoundaryFitter = (
  labels: Uint8Array,
  width: number,
  height: number,
  fitCurves: boolean,
  tolerance: number,
) => {
  const keyOf = ({ x, y }: Point) => y * (width + 1) + x;
  const labelAt = (x: number, y: number) =>
    x < 0 || y < 0 || x >= width || y >= height ? 255 : labels[y * width + x];
  const isJunction = ({ x, y }: Point) => {
    // Keep the four image corners fixed even when the frame is one long run.
    if ((x === 0 || x === width) && (y === 0 || y === height)) return true;
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
    return degree !== 2;
  };
  const fitted = new Map<number, { forward: Segment[]; backward: Segment[] }>();
  // Keep fitted chains close to their grid edges. Split the budget between
  // simplification and fitting, since both may displace an edge.
  const error = Math.max(0.01, Math.min(0.45, tolerance));
  const appendChain = (points: Point[], output: VectorCommand[]) => {
    const first = keyOf(points[0]);
    const last = keyOf(points[points.length - 1]);
    const reverse =
      first === last
        ? keyOf(points[1]) > keyOf(points[points.length - 2])
        : first > last;
    const start = reverse ? last : first;
    const next = keyOf(points[reverse ? points.length - 2 : 1]);
    const direction =
      next === start + 1 ? 0 : next > start ? 1 : next === start - 1 ? 2 : 3;
    const key = start * 4 + direction;
    let pair = fitted.get(key);
    if (!pair) {
      const ordered = reverse ? points.slice().reverse() : points;
      const simplified = simplifyOpen(ordered, fitCurves ? error / 2 : error);
      // Straight edges stay linear, including frame edges. At either end of
      // a curved chain keep the original unit edge as a junction tangent.
      const path =
        fitCurves && simplified.length > 2 && ordered.length > 4
          ? fitPointsToSubpath(ordered.slice(1, -1), false, error / 2)
          : pointsToSubpath(simplified, false);
      const forward = path.commands.slice(1) as Segment[];
      if (fitCurves && simplified.length > 2 && ordered.length > 4) {
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
    for (let index = 0; index < ring.length; index += 1) {
      if (isJunction(ring[index])) cuts.push(index);
      if (keyOf(ring[index]) < keyOf(ring[minimum])) minimum = index;
    }
    if (cuts.length === 0) cuts.push(minimum);
    const commands: VectorCommand[] = [{ type: "M", ...ring[cuts[0]] }];
    for (let index = 0; index < cuts.length; index += 1) {
      const start = cuts[index];
      const end = cuts[index + 1] ?? cuts[0] + ring.length;
      const points = [ring[start]];
      for (let cursor = start + 1; cursor <= end; cursor += 1)
        points.push(ring[cursor % ring.length]);
      appendChain(points, commands);
    }
    commands.push({ type: "Z" });
    return { commands, closed: true };
  };
};
