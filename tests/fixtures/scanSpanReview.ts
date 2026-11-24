type Point = [number, number];
export interface PathReference {
  id: string;
  points: Point[];
  radius: number;
}

const distanceToSegment = (
  x: number,
  y: number,
  [ax, ay]: Point,
  [bx, by]: Point,
) => {
  const dx = bx - ax;
  const dy = by - ay;
  const at = Math.min(
    1,
    Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(x - ax - at * dx, y - ay - at * dy);
};

export const measurePath = (
  raster: Buffer,
  width: number,
  height: number,
  reference: PathReference,
) => {
  const { points, radius } = reference;
  const [ax, ay] = points[0];
  const [bx, by] = points.at(-1)!;
  const endpointRadius = Math.min(
    radius + 0.5,
    Math.hypot(bx - ax, by - ay) / 3,
  );
  const allowed = new Uint8Array(width * height);
  const queue: number[] = [];
  const segments = points
    .slice(1)
    .map((point, index) => [points[index], point] as const);
  let reachesEnd = false;
  for (let index = 0; index < raster.length; index += 1) {
    if (raster[index] < 64) continue;
    const x = (index % width) + 0.5;
    const y = Math.floor(index / width) + 0.5;
    if (
      !segments.some(
        ([start, end]) => distanceToSegment(x, y, start, end) <= radius,
      )
    )
      continue;
    const atEnd = Math.hypot(x - bx, y - by) <= endpointRadius;
    allowed[index] = atEnd ? 2 : 1;
    reachesEnd ||= atEnd;
    if (Math.hypot(x - ax, y - ay) <= endpointRadius) queue.push(index);
  }
  const endpoints = Number(queue.length > 0) + Number(reachesEnd);
  for (let i = 0; i < queue.length; i += 1) {
    const pixel = queue[i];
    if (allowed[pixel] === 2) return { endpoints, connected: true };
    if (!allowed[pixel]) continue;
    allowed[pixel] = 0;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    for (let dy = -1; dy <= 1; dy += 1)
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (allowed[next]) queue.push(next);
      }
  }
  return { endpoints, connected: false };
};

// A partitioned outline can be closed even when every enclosed face is
// smaller than its full interior. Keep only stroke near the reviewed outline
// and run the same enclosed-region measurement on those real pixels.
export const isolateOutline = (
  stroke: Buffer,
  width: number,
  height: number,
  points: Point[],
  radius: number,
) => {
  const isolated = Buffer.alloc(stroke.length);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const left = Math.max(0, Math.floor(Math.min(...xs) - radius));
  const right = Math.min(width, Math.ceil(Math.max(...xs) + radius));
  const top = Math.max(0, Math.floor(Math.min(...ys) - radius));
  const bottom = Math.min(height, Math.ceil(Math.max(...ys) + radius));
  for (let y = top; y < bottom; y += 1)
    for (let x = left; x < right; x += 1) {
      const index = y * width + x;
      if (
        stroke[index] >= 64 &&
        points.some(
          (start, i) =>
            distanceToSegment(
              x + 0.5,
              y + 0.5,
              start,
              points[(i + 1) % points.length],
            ) <= radius,
        )
      )
        isolated[index] = stroke[index];
    }
  return isolated;
};
