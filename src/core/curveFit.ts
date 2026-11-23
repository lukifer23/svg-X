import type { Point } from "./geometry";
import type { VectorCommand, VectorSubpath } from "./vectorDocument";

interface Cubic {
  p0: Point;
  p1: Point;
  p2: Point;
  p3: Point;
}

interface FitRange {
  start: number;
  end: number;
  leftTangent: Point;
  rightTangent: Point;
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
  const b0 = u ** 3;
  const b1 = 3 * u ** 2 * t;
  const b2 = 3 * u * t ** 2;
  const b3 = t ** 3;
  return {
    x: b0 * curve.p0.x + b1 * curve.p1.x + b2 * curve.p2.x + b3 * curve.p3.x,
    y: b0 * curve.p0.y + b1 * curve.p1.y + b2 * curve.p2.y + b3 * curve.p3.y,
  };
};

const parameterize = (
  lengths: Float64Array,
  parameters: Float64Array,
  { start, end }: FitRange,
): number => {
  // Accumulate from zero within each range to preserve the original rounding
  // order when a candidate splits.
  parameters[start] = 0;
  for (let index = start + 1; index <= end; index += 1)
    parameters[index] = parameters[index - 1] + lengths[index];
  const total = parameters[end];
  if (total > Number.EPSILON) {
    for (let index = start; index <= end; index += 1)
      parameters[index] /= total;
  } else {
    for (let index = start; index <= end; index += 1)
      parameters[index] = (index - start) / (end - start);
  }
  return total;
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
  parameters: Float64Array,
  length: number,
  { start: first, end: last, leftTangent, rightTangent }: FitRange,
): Cubic => {
  const start = points[first];
  const end = points[last];
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;
  for (let index = first; index <= last; index += 1) {
    const t = parameters[index];
    const u = 1 - t;
    const b0 = u ** 3;
    const b1 = 3 * t * u ** 2;
    const b2 = 3 * t ** 2 * u;
    const b3 = t ** 3;
    const a0x = leftTangent.x * b1;
    const a0y = leftTangent.y * b1;
    const a1x = rightTangent.x * b2;
    const a1y = rightTangent.y * b2;
    const startWeight = b0 + b1;
    const endWeight = b2 + b3;
    const residualX =
      points[index].x - (start.x * startWeight + end.x * endWeight);
    const residualY =
      points[index].y - (start.y * startWeight + end.y * endWeight);
    c00 += a0x * a0x + a0y * a0y;
    c01 += a0x * a1x + a0y * a1y;
    c11 += a1x * a1x + a1y * a1y;
    x0 += a0x * residualX + a0y * residualY;
    x1 += a1x * residualX + a1y * residualY;
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
  const maximumHandle = Math.max(segmentLength, length) * 2;
  if (alpha0 > maximumHandle || alpha1 > maximumHandle)
    return lineCubic(start, end);
  return {
    p0: start,
    p1: add(start, scale(leftTangent, alpha0)),
    p2: add(end, scale(rightTangent, alpha1)),
    p3: end,
  };
};

const curveStaysNearPolyline = (
  curve: Cubic,
  points: Point[],
  { start: first, end: last }: FitRange,
  maximumError: number,
): boolean => {
  const margin = Math.max(0.05, maximumError);
  let minimumX = Infinity;
  let maximumX = -Infinity;
  let minimumY = Infinity;
  let maximumY = -Infinity;
  for (let index = first; index <= last; index += 1) {
    const { x, y } = points[index];
    minimumX = Math.min(minimumX, x);
    maximumX = Math.max(maximumX, x);
    minimumY = Math.min(minimumY, y);
    maximumY = Math.max(maximumY, y);
  }
  for (let sample = 0; sample <= 16; sample += 1) {
    const point = evaluateCubic(curve, sample / 16);
    if (
      point.x < minimumX - margin ||
      point.x > maximumX + margin ||
      point.y < minimumY - margin ||
      point.y > maximumY + margin
    )
      return false;
    let closest = Number.POSITIVE_INFINITY;
    for (let index = first + 1; index <= last; index += 1) {
      const start = points[index - 1];
      const end = points[index];
      const deltaX = end.x - start.x;
      const deltaY = end.y - start.y;
      const denominator = deltaX * deltaX + deltaY * deltaY;
      const parameter =
        denominator <= Number.EPSILON
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) /
                  denominator,
              ),
            );
      closest = Math.hypot(
        point.x - (start.x + parameter * deltaX),
        point.y - (start.y + parameter * deltaY),
      );
      if (closest <= margin) break;
    }
    if (closest > margin) return false;
  }
  return true;
};

const maximumError = (
  points: Point[],
  curve: Cubic,
  parameters: Float64Array,
  { start, end }: FitRange,
): { squared: number; split: number } => {
  let squared = 0;
  let split = start + Math.floor((end - start + 1) / 2);
  for (let index = start + 1; index < end; index += 1) {
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

const appendCubic = (commands: VectorCommand[], curve: Cubic): void => {
  commands.push({
    type: "C",
    x1: curve.p1.x,
    y1: curve.p1.y,
    x2: curve.p2.x,
    y2: curve.p2.y,
    x: curve.p3.x,
    y: curve.p3.y,
  });
};

const fitRanges = (
  points: Point[],
  initial: FitRange,
  maximumSquaredError: number,
  commands: VectorCommand[],
): void => {
  if (points.length === 2) {
    appendCubic(commands, lineCubic(points[0], points[1]));
    return;
  }
  const lengths = new Float64Array(points.length);
  for (let index = 1; index < points.length; index += 1)
    lengths[index] = Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y,
    );
  const parameters = new Float64Array(points.length);
  const permittedError = Math.sqrt(maximumSquaredError);
  const pending = [initial];
  while (pending.length > 0) {
    const range = pending.pop()!;
    const { start, end, leftTangent, rightTangent } = range;
    if (end === start + 1) {
      appendCubic(commands, lineCubic(points[start], points[end]));
      continue;
    }
    const length = parameterize(lengths, parameters, range);
    const curve = generateCubic(points, parameters, length, range);
    const error = maximumError(points, curve, parameters, range);
    const withinError = error.squared <= maximumSquaredError;
    if (
      withinError &&
      curveStaysNearPolyline(curve, points, range, permittedError)
    ) {
      appendCubic(commands, curve);
      continue;
    }
    const requestedSplit = withinError
      ? start + Math.floor((end - start + 1) / 2)
      : error.split;
    const split = Math.max(start + 1, Math.min(end - 1, requestedSplit));
    // Process the left range first to keep the source order of the commands.
    pending.push(
      {
        start: split,
        end,
        leftTangent: normalize(subtract(points[split + 1], points[split])),
        rightTangent,
      },
      {
        start,
        end: split,
        leftTangent,
        rightTangent: normalize(subtract(points[split - 1], points[split])),
      },
    );
  }
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
  const commands: VectorCommand[] = [
    { type: "M", x: fitInput[0].x, y: fitInput[0].y },
  ];
  fitRanges(
    fitInput,
    { start: 0, end: fitInput.length - 1, leftTangent, rightTangent },
    Math.max(0.01, maximumError) ** 2,
    commands,
  );
  if (closed) commands.push({ type: "Z" });
  return { commands, closed };
};
