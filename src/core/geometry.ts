import type { VectorCommand, VectorSubpath } from "./vectorDocument";

export interface Point {
  x: number;
  y: number;
}

const distanceToSegment = (point: Point, start: Point, end: Point): number => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0)
    return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) /
        (dx * dx + dy * dy),
    ),
  );
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
};

export const exceedsChordTolerance = (
  points: Point[],
  tolerance: number,
): boolean => {
  const start = points[0];
  const end = points[points.length - 1];
  for (let index = 1; index < points.length - 1; index += 1)
    if (distanceToSegment(points[index], start, end) > tolerance) return true;
  return false;
};

export const simplifyOpen = (points: Point[], tolerance: number): Point[] => {
  if (points.length <= 2) return points.slice();
  const result = [points[0]];
  const pendingEnds = [points.length - 1];
  let start = 0;
  while (pendingEnds.length > 0) {
    const end = pendingEnds[pendingEnds.length - 1];
    let furthest = tolerance;
    let split = -1;
    for (let i = start + 1; i < end; i += 1) {
      const distance = distanceToSegment(points[i], points[start], points[end]);
      if (distance > furthest) {
        furthest = distance;
        split = i;
      }
    }
    if (split !== -1) pendingEnds.push(split);
    else {
      result.push(points[end]);
      start = end;
      pendingEnds.pop();
    }
  }
  return result;
};

export const ringArea = (points: Point[]): number => {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const next = points[(i + 1) % points.length];
    area += points[i].x * next.y - next.x * points[i].y;
  }
  return area / 2;
};

export const simplifyRing = (points: Point[], tolerance: number): Point[] => {
  if (points.length <= 4) return points.slice();
  const withoutCollinear = points.filter((point, index) => {
    const previous = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    return (
      (point.x - previous.x) * (next.y - point.y) !==
      (point.y - previous.y) * (next.x - point.x)
    );
  });
  if (withoutCollinear.length <= 4) return withoutCollinear;
  let split = 1;
  let maxDistance = -1;
  for (let i = 1; i < withoutCollinear.length; i += 1) {
    const distance = Math.hypot(
      withoutCollinear[i].x - withoutCollinear[0].x,
      withoutCollinear[i].y - withoutCollinear[0].y,
    );
    if (distance > maxDistance) {
      maxDistance = distance;
      split = i;
    }
  }
  const first = simplifyOpen(withoutCollinear.slice(0, split + 1), tolerance);
  const second = simplifyOpen(
    [...withoutCollinear.slice(split), withoutCollinear[0]],
    tolerance,
  );
  return [...first.slice(0, -1), ...second.slice(0, -1)];
};

export const pointsToSubpath = (
  points: Point[],
  closed: boolean,
): VectorSubpath => {
  const commands: VectorCommand[] =
    points.length > 0
      ? [
          { type: "M", x: points[0].x, y: points[0].y },
          ...points
            .slice(1)
            .map((point) => ({ type: "L", x: point.x, y: point.y }) as const),
        ]
      : [];
  if (closed && commands.length > 0) commands.push({ type: "Z" });
  return { commands, closed };
};
