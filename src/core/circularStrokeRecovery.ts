import type { Point } from "./geometry";
import type { ScanInkEvidence } from "./scanLighting";

interface Anchor extends Point {
  dx: number;
  dy: number;
}

interface Circle extends Point {
  radius: number;
  score: number;
}

const NEIGHBORS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
] as const;

const MIN_RADIUS = 16;
const MAX_RADIUS = 128;
const CELL_SIZE = 7;
const MAX_ANCHORS = 96;
const CORRIDOR = 2;
const TRACKS = 2 * CORRIDOR + 1;
const MAX_WEAK_RUN = 5;
const PROBES = Array.from({ length: 48 }, (_, index) => {
  const angle = (index * Math.PI) / 24;
  return { x: Math.cos(angle), y: Math.sin(angle) };
});

const firstDirection = (bits: number) => 31 - Math.clz32(bits & -bits);

const collectAnchors = (
  skeleton: Uint8Array,
  width: number,
  { contrast, minimumContrast }: ScanInkEvidence,
  neighborsAt: (index: number) => number,
) => {
  const offsets = NEIGHBORS.map(([dx, dy]) => dy * width + dx);
  const follow = (start: number, direction: number) => {
    let pixel = start;
    for (let step = 0; step < 5; step += 1) {
      pixel += offsets[direction];
      const forward = neighborsAt(pixel) & ~(1 << ((direction + 4) % 8));
      if (!forward || (forward & (forward - 1)) !== 0) break;
      direction = firstDirection(forward);
    }
    return pixel;
  };
  const columns = Math.ceil(width / CELL_SIZE);
  const anchors = new Map<number, Anchor>();
  for (let index = 0; index < skeleton.length; index += 1) {
    if (!skeleton[index] || contrast[index] > 4 * minimumContrast) continue;
    const x = index % width;
    const y = (index - x) / width;
    const cell =
      Math.floor(y / CELL_SIZE) * columns + Math.floor(x / CELL_SIZE);
    if (anchors.has(cell)) continue;
    const bits = neighborsAt(index);
    const remainder = bits & (bits - 1);
    if (!remainder || (remainder & (remainder - 1)) !== 0) continue;
    const a = follow(index, firstDirection(bits));
    const b = follow(index, firstDirection(remainder));
    const dx = (b % width) - (a % width);
    const dy = Math.floor(b / width) - Math.floor(a / width);
    const length = Math.hypot(dx, dy);
    const bend = dx * (y - Math.floor(a / width)) - dy * (x - (a % width));
    if (length >= 6 && Math.abs(bend) >= 0.3 * length)
      anchors.set(cell, { x, y, dx: dx / length, dy: dy / length });
  }
  const sampled = [...anchors.values()];
  if (sampled.length <= MAX_ANCHORS) return sampled;
  return Array.from(
    { length: MAX_ANCHORS },
    (_, i) => sampled[Math.floor((i * sampled.length) / MAX_ANCHORS)],
  );
};

const locateCircles = (
  anchors: Anchor[],
  width: number,
  height: number,
  contrast: Uint8Array,
  skeleton: Uint8Array,
): Circle[] => {
  const checked = new Set<number>();
  const candidates: Circle[] = [];
  const columns = Math.ceil(width / 2);
  const rows = Math.ceil(height / 2);
  const sample = (x: number, y: number) =>
    contrast[Math.round(y) * width + Math.round(x)];
  const evidenceAt = (x: number, y: number, radius: number, vector: Point) => {
    let best = 0;
    for (let shift = -CORRIDOR; shift <= CORRIDOR; shift += 1) {
      const r = radius + shift;
      const center = sample(x + r * vector.x, y + r * vector.y);
      if (center < 6) continue;
      const left = sample(x + (r - 2) * vector.x, y + (r - 2) * vector.y);
      const right = sample(x + (r + 2) * vector.x, y + (r + 2) * vector.y);
      best = Math.max(
        best,
        Math.min(20, center) -
          0.35 * Math.max(left, right) -
          0.9 * Math.abs(shift),
      );
    }
    return best;
  };

  for (let i = 0; i < anchors.length; i += 1) {
    const a = anchors[i];
    for (let j = i + 1; j < anchors.length; j += 1) {
      const b = anchors[j];
      const dx = (b.x - a.x) / 2;
      const dy = (b.y - a.y) / 2;
      const square = dx * dx + dy * dy;
      if (square < 64 || square > MAX_RADIUS * MAX_RADIUS) continue;
      const halfChord = Math.sqrt(square);
      const nx = -dy / halfChord;
      const ny = dx / halfChord;
      // The center lies on the perpendicular bisector. Fit its position
      // by minimizing disagreement with the two measured tangents.
      const normalA = nx * a.dx + ny * a.dy;
      const normalB = nx * b.dx + ny * b.dy;
      const strength = normalA * normalA + normalB * normalB;
      if (strength < 0.25) continue;
      const dotA = dx * a.dx + dy * a.dy;
      const dotB = dx * b.dx + dy * b.dy;
      const along = (normalB * dotB - normalA * dotA) / strength;
      const radius = Math.sqrt(along * along + square);
      if (radius < MIN_RADIUS || radius > MAX_RADIUS) continue;
      if (
        Math.max(
          Math.abs(dotA + normalA * along),
          Math.abs(-dotB + normalB * along),
        ) >
        0.15 * radius
      )
        continue;

      const x = a.x + dx + nx * along;
      const y = a.y + dy + ny * along;
      if (
        x - radius < 4 ||
        y - radius < 4 ||
        x + radius > width - 5 ||
        y + radius > height - 5
      )
        continue;
      const key =
        Math.round(x / 2) +
        columns * (Math.round(y / 2) + rows * Math.round(radius / 2));
      if (checked.has(key)) continue;
      checked.add(key);
      let weak = 0;
      let score = 0;
      // Inspect the cardinal quadrants and their neighbors first to
      // reject lines and incomplete arcs before scoring a full circle.
      for (let phase = 0; phase < 4 && weak <= 2; phase += 1) {
        for (let k = phase; k < PROBES.length; k += 4) {
          const evidence = evidenceAt(x, y, radius, PROBES[k]);
          if (evidence <= 2) {
            weak = 3;
            break;
          }
          if (evidence < 7 && ++weak > 2) break;
          score += evidence;
        }
      }
      if (weak > 2) continue;
      // Skip nearly complete curves before searching the ink corridor.
      let traced = 0;
      for (let k = 0; k < PROBES.length; k += 4) {
        const vector = PROBES[k];
        for (let shift = -CORRIDOR; shift <= CORRIDOR; shift += 1) {
          const r = radius + shift;
          const pixel =
            Math.round(y + r * vector.y) * width + Math.round(x + r * vector.x);
          if (!skeleton[pixel]) continue;
          traced += 1;
          break;
        }
      }
      if (traced < 10) candidates.push({ x, y, radius, score });
    }
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, 8);
};

const traceAnnulus = (
  { x, y, radius }: Circle,
  width: number,
  contrast: Uint8Array,
  skeleton: Uint8Array,
) => {
  const samples = Math.ceil(2 * Math.PI * radius);
  const positions = new Int32Array(samples * TRACKS);
  const scores = new Float32Array(positions.length);
  const supportScore = new Float32Array(positions.length);
  const minRidges = 0.9 * samples;
  for (let angle = 0; angle < samples; angle += 1) {
    const theta = (2 * Math.PI * angle) / samples;
    const dx = Math.cos(theta);
    const dy = Math.sin(theta);
    const at = (r: number) =>
      Math.round(y + r * dy) * width + Math.round(x + r * dx);
    for (let shift = -CORRIDOR; shift <= CORRIDOR; shift += 1) {
      const slot = angle * TRACKS + shift + CORRIDOR;
      const r = radius + shift;
      const position = at(r);
      positions[slot] = position;
      supportScore[slot] =
        Math.min(20, contrast[position]) -
        0.45 * Math.max(contrast[at(r - 2)], contrast[at(r + 2)]);
      scores[slot] = supportScore[slot] + (skeleton[position] ? 4 : 0);
    }
  }
  let best = -Infinity;
  let ring: number[] = [];
  const previous = new Float32Array(TRACKS);
  const next = new Float32Array(TRACKS);
  const parent = new Int8Array(positions.length);
  // Fix the starting track in turn and require a compatible final track.
  // The path can follow slight radius changes without taking a shortcut.
  for (let initial = 0; initial < TRACKS; initial += 1) {
    previous.fill(-Infinity);
    previous[initial] = scores[initial];
    for (let angle = 1; angle < samples; angle += 1) {
      const base = angle * TRACKS;
      for (let slot = 0; slot < TRACKS; slot += 1) {
        let prior = slot;
        for (
          let k = Math.max(0, slot - 1);
          k <= Math.min(TRACKS - 1, slot + 1);
          k += 1
        )
          if (previous[k] - 3 > previous[prior]) prior = k;
        parent[base + slot] = prior;
        next[slot] =
          previous[prior] -
          (prior === slot ? 0 : 3) +
          scores[base + slot] -
          1.3 * Math.abs(slot - CORRIDOR);
      }
      previous.set(next);
    }
    for (
      let end = Math.max(0, initial - 1);
      end <= Math.min(TRACKS - 1, initial + 1);
      end += 1
    ) {
      const score = previous[end] - (end === initial ? 0 : 3);
      if (score <= best) continue;
      const points: number[] = [];
      let ridges = 0;
      let weakRun = 0;
      let longestWeakRun = 0;
      let trailingWeakRun = 0;
      let slot = end;
      for (let angle = samples - 1; angle >= 0; angle -= 1) {
        const index = angle * TRACKS + slot;
        points.push(positions[index]);
        if (supportScore[index] >= 4) {
          ridges += 1;
          weakRun = 0;
        } else {
          weakRun += 1;
          longestWeakRun = Math.max(longestWeakRun, weakRun);
          if (!ridges) trailingWeakRun = weakRun;
        }
        slot = parent[index];
      }
      if (
        ridges < minRidges ||
        Math.max(longestWeakRun, weakRun + trailingWeakRun) > MAX_WEAK_RUN
      )
        continue;
      best = score;
      ring = points.reverse();
    }
  }
  return ring;
};

export const recoverCircularStrokes = (
  skeleton: Uint8Array,
  width: number,
  height: number,
  evidence: ScanInkEvidence,
  neighborsAt: (index: number) => number,
): Point[][] => {
  if (Math.min(width, height) < MIN_RADIUS * 2 + 9) return [];
  const cached = new Uint16Array(skeleton.length);
  const adjacency = (pixel: number) => {
    if (!cached[pixel]) cached[pixel] = neighborsAt(pixel) + 1;
    return cached[pixel] - 1;
  };
  const anchors = collectAnchors(skeleton, width, evidence, adjacency);
  const circles = locateCircles(
    anchors,
    width,
    height,
    evidence.contrast,
    skeleton,
  );
  const recovered: Array<{ circle: Circle; points: Point[] }> = [];
  const replacedPixels = new Set<number>();
  for (const circle of circles) {
    if (
      recovered.some(
        ({ circle: prior }) =>
          Math.hypot(circle.x - prior.x, circle.y - prior.y) +
            Math.abs(circle.radius - prior.radius) <
          6,
      )
    )
      continue;
    const points = traceAnnulus(circle, width, evidence.contrast, skeleton);
    if (!points.length) continue;
    let covered = 0;
    const duplicates = new Set<number>();
    const support = new Uint8Array(8);
    for (let i = 0; i < points.length; i += 1) {
      const pixel = points[i];
      let found = false;
      for (const offset of [0, 1, -1, width, -width]) {
        const near = pixel + offset;
        if (!skeleton[near]) continue;
        found = true;
        if (near !== pixel) continue;
        const bits = adjacency(near);
        const x = near % width;
        const y = (near - x) / width;
        let tangent = 0;
        let radial = 0;
        for (let n = 0; n < NEIGHBORS.length; n += 1) {
          if (!(bits & (1 << n))) continue;
          const [dx, dy] = NEIGHBORS[n];
          if (
            Math.abs(dx * (x - circle.x) + dy * (y - circle.y)) <=
            0.65 * circle.radius * Math.hypot(dx, dy)
          )
            tangent += 1;
          else radial += 1;
        }
        // The closed subpath replaces exact, tangential overlap. Keep
        // the existing stroke at junctions and radial contacts.
        if (tangent && !radial) duplicates.add(near);
      }
      covered += Number(found);
      support[Math.floor((i * support.length) / points.length)] |=
        Number(found);
    }
    if (
      covered > points.length * 0.78 ||
      covered < points.length * 0.22 ||
      support.reduce((a, b) => a + b, 0) < 4
    )
      continue;
    for (const pixel of duplicates) replacedPixels.add(pixel);
    const unique = points.filter(
      (index, i) => index !== points[(i + points.length - 1) % points.length],
    );
    recovered.push({
      circle,
      points: unique.map((pixel) => ({
        x: (pixel % width) + 0.5,
        y: Math.floor(pixel / width) + 0.5,
      })),
    });
  }
  for (const pixel of replacedPixels) skeleton[pixel] = 0;
  return recovered.map(({ points }) => points);
};
