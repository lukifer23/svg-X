import type { Point } from "./geometry";
import type { VectorCommand, VectorSubpath } from "./vectorDocument";

interface Cubic {
  p0: Point;
  p1: Point;
  p2: Point;
  p3: Point;
}

const add = (left: Point, right: Point): Point => ({
  x: left.x + right.x,
  y: left.y + right.y,
});
const subtract = (left: Point, right: Point): Point => ({
  x: left.x - right.x,
  y: left.y - right.y,
});
const scale = (point: Point, amount: number): Point => ({
  x: point.x * amount,
  y: point.y * amount,
});
const dot = (left: Point, right: Point): number =>
  left.x * right.x + left.y * right.y;
const normalize = (point: Point): Point => {
  const length = Math.hypot(point.x, point.y);
  return length > Number.EPSILON
    ? { x: point.x / length, y: point.y / length }
    : { x: 0, y: 0 };
};

export const evaluateCubic = (curve: Cubic, t: number): Point => {
  const u = 1 - t;
  return {
    x:
      u ** 3 * curve.p0.x +
      3 * u ** 2 * t * curve.p1.x +
      3 * u * t ** 2 * curve.p2.x +
      t ** 3 * curve.p3.x,
    y:
      u ** 3 * curve.p0.y +
      3 * u ** 2 * t * curve.p1.y +
      3 * u * t ** 2 * curve.p2.y +
      t ** 3 * curve.p3.y,
  };
};

const parameterize = (points: Point[]): number[] => {
  const parameters = [0];
  for (let index = 1; index < points.length; index += 1) {
    parameters.push(
      parameters[index - 1] +
        Math.hypot(
          points[index].x - points[index - 1].x,
          points[index].y - points[index - 1].y,
        ),
    );
  }
  const total = parameters[parameters.length - 1];
  return total > Number.EPSILON
    ? parameters.map((value) => value / total)
    : parameters.map((_value, index) => index / (parameters.length - 1));
};

const lineCubic = (start: Point, end: Point): Cubic => {
  const delta = subtract(end, start);
  return {
    p0: start,
    p1: add(start, scale(delta, 1 / 3)),
    p2: add(start, scale(delta, 2 / 3)),
    p3: end,
  };
};

const generateCubic = (
  points: Point[],
  parameters: number[],
  leftTangent: Point,
  rightTangent: Point,
): Cubic => {
  const start = points[0];
  const end = points[points.length - 1];
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;
  for (let index = 0; index < points.length; index += 1) {
    const t = parameters[index];
    const u = 1 - t;
    const b0 = u ** 3;
    const b1 = 3 * t * u ** 2;
    const b2 = 3 * t ** 2 * u;
    const b3 = t ** 3;
    const a0 = scale(leftTangent, b1);
    const a1 = scale(rightTangent, b2);
    const base = add(scale(start, b0 + b1), scale(end, b2 + b3));
    const residual = subtract(points[index], base);
    c00 += dot(a0, a0);
    c01 += dot(a0, a1);
    c11 += dot(a1, a1);
    x0 += dot(a0, residual);
    x1 += dot(a1, residual);
  }
  const determinant = c00 * c11 - c01 * c01;
  const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
  let alpha0 = segmentLength / 3;
  let alpha1 = segmentLength / 3;
  if (Math.abs(determinant) > 1e-12) {
    alpha0 = (x0 * c11 - x1 * c01) / determinant;
    alpha1 = (c00 * x1 - c01 * x0) / determinant;
  }
  const minimum = segmentLength * 1e-6;
  if (
    !Number.isFinite(alpha0) ||
    !Number.isFinite(alpha1) ||
    alpha0 < minimum ||
    alpha1 < minimum
  )
    return lineCubic(start, end);
  return {
    p0: start,
    p1: add(start, scale(leftTangent, alpha0)),
    p2: add(end, scale(rightTangent, alpha1)),
    p3: end,
  };
};

const maximumError = (
  points: Point[],
  curve: Cubic,
  parameters: number[],
): { squared: number; split: number } => {
  let squared = 0;
  let split = Math.floor(points.length / 2);
  for (let index = 1; index < points.length - 1; index += 1) {
    const sample = evaluateCubic(curve, parameters[index]);
    const delta = subtract(sample, points[index]);
    const candidate = dot(delta, delta);
    if (candidate > squared) {
      squared = candidate;
      split = index;
    }
  }
  return { squared, split };
};

const fitRecursive = (
  points: Point[],
  leftTangent: Point,
  rightTangent: Point,
  maximumSquaredError: number,
): Cubic[] => {
  if (points.length === 2) return [lineCubic(points[0], points[1])];
  const parameters = parameterize(points);
  const curve = generateCubic(points, parameters, leftTangent, rightTangent);
  const error = maximumError(points, curve, parameters);
  if (error.squared <= maximumSquaredError) return [curve];
  const split = Math.max(1, Math.min(points.length - 2, error.split));
  const leftEndTangent = normalize(subtract(points[split - 1], points[split]));
  const rightStartTangent = normalize(
    subtract(points[split + 1], points[split]),
  );
  return [
    ...fitRecursive(
      points.slice(0, split + 1),
      leftTangent,
      leftEndTangent,
      maximumSquaredError,
    ),
    ...fitRecursive(
      points.slice(split),
      rightStartTangent,
      rightTangent,
      maximumSquaredError,
    ),
  ];
};

export const fitPointsToSubpath = (
  input: Point[],
  closed: boolean,
  maximumError: number,
): VectorSubpath => {
  const points = input.filter(
    (point, index) =>
      index === 0 ||
      point.x !== input[index - 1].x ||
      point.y !== input[index - 1].y,
  );
  if (points.length < 2) return { commands: [], closed };
  const fitInput = closed ? [...points, points[0]] : points;
  const leftTangent = closed
    ? normalize(subtract(points[1], points[points.length - 1]))
    : normalize(subtract(points[1], points[0]));
  const rightTangent = closed
    ? scale(leftTangent, -1)
    : normalize(subtract(points[points.length - 2], points[points.length - 1]));
  const cubics = fitRecursive(
    fitInput,
    leftTangent,
    rightTangent,
    Math.max(0.01, maximumError) ** 2,
  );
  const commands: VectorCommand[] = [
    { type: "M", x: fitInput[0].x, y: fitInput[0].y },
    ...cubics.map((curve): VectorCommand => ({
      type: "C",
      x1: curve.p1.x,
      y1: curve.p1.y,
      x2: curve.p2.x,
      y2: curve.p2.y,
      x: curve.p3.x,
      y: curve.p3.y,
    })),
  ];
  if (closed) commands.push({ type: "Z" });
  return { commands, closed };
};
