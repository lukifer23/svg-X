import sharp, { type Sharp } from "sharp";
import { readFile } from "node:fs/promises";
import type { Point } from "../../src/core/geometry";
import type {
  VectorDocument,
  WorkerConversionOptions,
} from "../../src/core/vectorDocument";

type Stroke = ReadonlyArray<readonly [number, number]>;
const parallel: Stroke[] = [
  [
    [18.5, 32.5],
    [105.5, 32.5],
    [140.5, 67.5],
    [222.5, 67.5],
  ],
  [
    [18.5, 38.5],
    [103.5, 38.5],
    [138.5, 73.5],
    [222.5, 73.5],
  ],
];
const junction: Stroke[] = [
  [
    [20.5, 48.5],
    [82.5, 48.5],
  ],
  [
    [82.5, 48.5],
    [147.5, 48.5],
  ],
  [
    [82.5, 16.5],
    [82.5, 48.5],
  ],
  [
    [82.5, 48.5],
    [82.5, 87.5],
    [115.5, 87.5],
  ],
  [
    [183.5, 15.5],
    [183.5, 51.5],
  ],
  [
    [159.5, 51.5],
    [183.5, 51.5],
  ],
  [
    [183.5, 51.5],
    [218.5, 83.5],
  ],
];
const loops: Stroke[] = [
  [
    [22.5, 23.5],
    [78.5, 23.5],
    [82.5, 46.5],
    [78.5, 73.5],
    [22.5, 73.5],
    [22.5, 23.5],
  ],
  [
    [143.5, 48.5],
    [143.5, 22.5],
    [196.5, 22.5],
    [210.5, 48.5],
    [196.5, 75.5],
    [143.5, 75.5],
    [143.5, 48.5],
  ],
  [
    [107.5, 48.5],
    [143.5, 48.5],
  ],
];

export const centerlineOptions: WorkerConversionOptions = {
  mode: "centerline",
  threshold: 128,
  turdSize: 2,
  turnPolicy: "minority",
  alphaMax: 1,
  optCurve: false,
  optTolerance: 0.2,
  blackOnWhite: true,
  invert: false,
  foregroundColor: "#000000",
  backgroundColor: "transparent",
  colorSteps: 8,
  fillStrategy: "dominant",
  strokeWidth: 2,
  maxPaths: 2000,
};

interface Raster {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface CenterlineCase {
  name: string;
  image: Raster;
  reference?: Point[][];
  topology?: { tips: number; junctions: number; loops: number };
}

const raster = async (image: Sharp): Promise<Raster> => {
  const { data, info } = await image
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    pixels: new Uint8ClampedArray(data),
    width: info.width,
    height: info.height,
  };
};

const artwork = (strokes: Stroke[]) =>
  Buffer.from(
    `<svg width="240" height="176" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="black" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${strokes.map((stroke) => `<polyline points="${stroke.map((point) => point.join(",")).join(" ")}"/>`).join("")}</g></svg>`,
  );

const scanNoise = (image: Raster): Raster => {
  const { width, height } = image;
  const pixels = image.pixels.slice();
  let seed = 4301;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      if (random() > 0.006) continue;
      const offset = (y * width + x) * 4;
      if (pixels[offset] < 240 || pixels[offset + 4] < 240) continue;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[offset + channel] = 45;
        pixels[offset + 4 + channel] = 65;
      }
      x += 2;
    }
  }
  return { ...image, pixels };
};

export const centerlineCorpus = async (): Promise<CenterlineCase[]> => {
  const drawings = [
    {
      name: "close-parallel",
      strokes: parallel,
      topology: { tips: 4, junctions: 0, loops: 0 },
    },
    {
      name: "junctions",
      strokes: junction,
      topology: { tips: 7, junctions: 2, loops: 0 },
    },
    {
      name: "loops",
      strokes: loops,
      topology: { tips: 1, junctions: 1, loops: 2 },
    },
    {
      name: "noisy-scan",
      strokes: [
        ...parallel,
        ...loops.map((stroke) => stroke.map(([x, y]) => [x, y + 82] as const)),
      ],
      topology: { tips: 5, junctions: 1, loops: 2 },
    },
  ];
  const cases = await Promise.all(
    drawings.map(async ({ name, strokes, topology }) => {
      const image = await raster(sharp(artwork(strokes)));
      return {
        name,
        image: name === "noisy-scan" ? scanNoise(image) : image,
        reference: strokes.map((stroke) => stroke.map(([x, y]) => ({ x, y }))),
        topology,
      };
    }),
  );
  const source = await readFile(
    new URL("./review/centerline-mechanism.png", import.meta.url),
  );
  const image = await raster(
    sharp(source).resize(1000, 1000, { fit: "inside" }),
  );
  const scans = await Promise.all(
    ["wright", "velocipede", "marconi"].map(async (id) => {
      const name = `${id}-patent-scan`;
      const jpg = await readFile(
        new URL(`./review/${name}.png`, import.meta.url),
      );
      return { name, image: await raster(sharp(jpg)) };
    }),
  );
  // Equal-size marks with known truth: dark line fragments and a short
  // junction branch, plus weaker detached and attached grain.
  const fineDetail = await raster(
    sharp(
      Buffer.from(
        '<svg width="88" height="48" xmlns="http://www.w3.org/2000/svg"><path d="M8 20h70v1H8z M26 18h1v2h-1z M51 8h2v1h-2z" fill="#141414"/><path d="M55 19h1v1h-1z M62 34h2v1h-2z" fill="#414141"/></svg>',
      ),
    ),
  );
  return [
    ...cases,
    { name: "mechanism-artwork", image },
    { name: "mechanism-grain", image: scanNoise(image) },
    ...scans,
    {
      name: "fine-linework",
      image: fineDetail,
      reference: [
        [
          { x: 8.5, y: 20.5 },
          { x: 77.5, y: 20.5 },
        ],
        [
          { x: 26.5, y: 18.5 },
          { x: 26.5, y: 20.5 },
        ],
        [
          { x: 51.5, y: 8.5 },
          { x: 52.5, y: 8.5 },
        ],
      ],
      topology: { tips: 5, junctions: 1, loops: 0 },
    },
  ];
};

interface DistanceSummary {
  mean: number;
  outside: number;
}

interface TraceMeasurements extends NonNullable<CenterlineCase["topology"]> {
  paths: number;
  commands: number;
  tracedToSource?: DistanceSummary;
  sourceToTraced?: DistanceSummary;
}

export const measureCenterlines = (
  document: VectorDocument,
  reference?: Point[][],
): TraceMeasurements => {
  const paths =
    document.shapes.find((shape) => shape.id === "centerline-foreground")
      ?.subpaths ?? [];
  const adjacency = new Map<string, string[]>();
  const sampled: Point[] = [];
  const key = (point: Point) => `${point.x},${point.y}`;
  const connect = (start: string, end: string) => {
    const neighbors = adjacency.get(start) ?? [];
    neighbors.push(end);
    adjacency.set(start, neighbors);
  };
  let commands = 0;
  for (const path of paths) {
    let start: Point | undefined;
    let current: Point | undefined;
    for (const command of path.commands) {
      commands += 1;
      if (command.type === "M") {
        start = current = command;
        continue;
      }
      if (!current || !start) throw new Error("Malformed centerline path");
      const end = command.type === "Z" ? start : command;
      const points =
        command.type === "C"
          ? [
              current,
              { x: command.x1, y: command.y1 },
              { x: command.x2, y: command.y2 },
              end,
            ]
          : [current, end];
      const steps = Math.ceil(
        points
          .slice(1)
          .reduce(
            (total, p, i) =>
              total + Math.hypot(p.x - points[i].x, p.y - points[i].y),
            0,
          ) * 2,
      );
      for (let step = 0; reference && step < steps; step += 1) {
        const t = step / steps;
        const u = 1 - t;
        const weights =
          points.length === 4
            ? [u ** 3, 3 * u ** 2 * t, 3 * u * t ** 2, t ** 3]
            : [u, t];
        sampled.push(
          points.reduce(
            (p, value, i) => ({
              x: p.x + value.x * weights[i],
              y: p.y + value.y * weights[i],
            }),
            { x: 0, y: 0 },
          ),
        );
      }
      current = end;
    }
    if (!current || !start) continue;
    if (reference) sampled.push(current);
    connect(key(start), key(current));
    connect(key(current), key(start));
  }
  let components = 0;
  const visited = new Set<string>();
  for (const vertex of adjacency.keys()) {
    if (visited.has(vertex)) continue;
    components += 1;
    const stack = [vertex];
    visited.add(vertex);
    while (stack.length) {
      const next = stack.pop()!;
      for (const neighbor of adjacency.get(next) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        stack.push(neighbor);
      }
    }
  }
  const degrees = [...adjacency.values()].map((neighbors) => neighbors.length);
  const stats = {
    paths: paths.length,
    commands,
    tips: degrees.filter((degree) => degree === 1).length,
    junctions: degrees.filter((degree) => degree > 2).length,
    loops: paths.length - adjacency.size + components,
  };
  if (!reference) return stats;
  const expected = reference.flatMap((stroke) =>
    stroke.slice(1).flatMap((end, i) => {
      const start = stroke[i];
      const steps = Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) * 2);
      return Array.from({ length: steps + 1 }, (_, j) => ({
        x: start.x + ((end.x - start.x) * j) / steps,
        y: start.y + ((end.y - start.y) * j) / steps,
      }));
    }),
  );
  const distance = (from: Point[], to: Point[]) => {
    const values = from.map((a) => {
      let smallest = Infinity;
      for (const b of to)
        smallest = Math.min(smallest, (a.x - b.x) ** 2 + (a.y - b.y) ** 2);
      return Math.sqrt(smallest);
    });
    return {
      mean: values.reduce((total, value) => total + value, 0) / values.length,
      outside: values.filter((value) => value > 1.5).length / values.length,
    };
  };
  return {
    ...stats,
    tracedToSource: distance(sampled, expected),
    sourceToTraced: distance(expected, sampled),
  };
};
