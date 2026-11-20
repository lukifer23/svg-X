import sharp from "sharp";
import { serializeVectorDocument } from "../../src/core/serialize";
import type { VectorDocument } from "../../src/core/vectorDocument";
import references from "./review/archival-loop-references.json";

export const rasterizeStroke = async (document: VectorDocument) => {
  const shapes = document.shapes.map((shape) => ({ ...shape, strokeWidth: 1 }));
  return sharp(Buffer.from(serializeVectorDocument({ ...document, shapes })))
    .extractChannel("alpha")
    .raw()
    .toBuffer();
};

export const enclosedRegions = (
  stroke: Buffer,
  width: number,
  height: number,
) => {
  const labels = new Int32Array(stroke.length);
  const areas = [0];
  const exterior = [false];
  const queue: number[] = [];
  for (let start = 0; start < stroke.length; start += 1) {
    if (stroke[start] >= 64 || labels[start]) continue;
    const id = areas.length;
    queue.length = 0;
    queue.push(start);
    labels[start] = id;
    let frame = false;
    const offer = (pixel: number) => {
      if (!labels[pixel] && stroke[pixel] < 64) {
        labels[pixel] = id;
        queue.push(pixel);
      }
    };
    for (let i = 0; i < queue.length; i += 1) {
      const pixel = queue[i];
      const x = pixel % width;
      const y = (pixel - x) / width;
      frame ||= x === 0 || y === 0 || x + 1 === width || y + 1 === height;
      if (x > 0) offer(pixel - 1);
      if (x + 1 < width) offer(pixel + 1);
      if (y > 0) offer(pixel - width);
      if (y + 1 < height) offer(pixel + width);
    }
    exterior.push(frame);
    areas.push(!frame && queue.length >= 4 ? queue.length : 0);
  }
  return { labels, areas, exterior };
};

type ArchivalReference = {
  loops: Record<string, number[][]>;
  open: Record<string, number[][]>;
  paper: number[][];
};

export const measureArchivalReference = (
  stroke: Buffer,
  width: number,
  height: number,
  reference: ArchivalReference,
) => {
  const { loops, open, paper } = reference;
  const { labels, areas, exterior } = enclosedRegions(stroke, width, height);
  return {
    loops: Object.fromEntries(
      Object.entries(loops).map(([name, points]) => {
        const overlaps = new Map<number, number>();
        let area = 0;
        const xs = points.map(([x]) => x);
        const ys = points.map(([, y]) => y);
        const right = Math.ceil(Math.max(...xs));
        const bottom = Math.ceil(Math.max(...ys));
        for (let y = Math.floor(Math.min(...ys)); y < bottom; y += 1) {
          for (let x = Math.floor(Math.min(...xs)); x < right; x += 1) {
            const py = y + 0.5;
            let inside = false;
            for (let i = 0; i < points.length; i += 1) {
              const [ax, ay] = points[i];
              const [bx, by] = points[(i + 1) % points.length];
              if (
                ay > py !== by > py &&
                ax + ((py - ay) * (bx - ax)) / (by - ay) > x + 0.5
              )
                inside = !inside;
            }
            if (!inside) continue;
            area += 1;
            const id = labels[y * width + x];
            if (areas[id]) overlaps.set(id, (overlaps.get(id) ?? 0) + 1);
          }
        }
        const iou = Math.max(
          0,
          ...Array.from(
            overlaps,
            ([id, count]) => count / (area + areas[id] - count),
          ),
        );
        return [name, { iou, matched: iou >= 0.55 }];
      }),
    ),
    open: Object.fromEntries(
      Object.entries(open).map(([name, points]) => [
        name,
        points.every(([x, y]) => {
          const id = labels[y * width + x];
          return exterior[id];
        }),
      ]),
    ),
    paperStrokePixels: paper.map(([left, top, right, bottom]) => {
      let count = 0;
      for (let y = top; y < bottom; y += 1)
        for (let x = left; x < right; x += 1)
          count += Number(stroke[y * width + x] >= 64);
      return count;
    }),
  };
};

export const archivalReferences: Readonly<
  Partial<Record<string, ArchivalReference>>
> = references;
