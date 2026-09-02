import { describe, expect, test } from "vitest";
import { evaluateCubic, fitPointsToSubpath } from "./curveFit";
import type { Point } from "./geometry";

const cubicSegments = (subpath: ReturnType<typeof fitPointsToSubpath>) => {
  const segments: Array<{
    p0: Point;
    p1: Point;
    p2: Point;
    p3: Point;
  }> = [];
  let current: Point | null = null;
  for (const command of subpath.commands) {
    if (command.type === "M" || command.type === "L") {
      current = { x: command.x, y: command.y };
    } else if (command.type === "C" && current) {
      const next = { x: command.x, y: command.y };
      segments.push({
        p0: current,
        p1: { x: command.x1, y: command.y1 },
        p2: { x: command.x2, y: command.y2 },
        p3: next,
      });
      current = next;
    }
  }
  return segments;
};

describe("error-bounded cubic fitting", () => {
  test("fits a smooth open chain with bounded point residual", () => {
    const points = Array.from({ length: 31 }, (_value, index) => ({
      x: index,
      y: 8 + Math.sin(index / 4) * 5,
    }));
    const maximumError = 0.25;
    const subpath = fitPointsToSubpath(points, false, maximumError);
    const segments = cubicSegments(subpath);
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.length).toBeLessThan(points.length - 1);
    for (const point of points) {
      let closest = Number.POSITIVE_INFINITY;
      for (const segment of segments) {
        for (let sample = 0; sample <= 200; sample += 1) {
          const candidate = evaluateCubic(segment, sample / 200);
          closest = Math.min(
            closest,
            Math.hypot(candidate.x - point.x, candidate.y - point.y),
          );
        }
      }
      expect(closest).toBeLessThanOrEqual(maximumError + 0.08);
    }
  });

  test("closes rings with cubic geometry and a real close command", () => {
    const points = Array.from({ length: 24 }, (_value, index) => {
      const angle = (index / 24) * Math.PI * 2;
      return { x: 20 + Math.cos(angle) * 10, y: 20 + Math.sin(angle) * 10 };
    });
    const subpath = fitPointsToSubpath(points, true, 0.3);
    expect(subpath.closed).toBe(true);
    expect(subpath.commands.some((command) => command.type === "C")).toBe(true);
    expect(subpath.commands[subpath.commands.length - 1].type).toBe("Z");
  });
});
