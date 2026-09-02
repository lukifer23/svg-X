import type {
  VectorCommand,
  VectorDocument,
  VectorShape,
} from "./vectorDocument";

const fixed = (value: number): string => Number(value.toFixed(4)).toString();

const paintRgb = (paint: string): [number, number, number] => {
  const hex = paint.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (hex) {
    const expanded =
      hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
    return [0, 2, 4].map(
      (index) => parseInt(expanded.slice(index, index + 2), 16) / 255,
    ) as [number, number, number];
  }
  const rgb = paint.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
  return rgb
    ? [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255]
    : [0, 0, 0];
};

const epsCommands = (shape: VectorShape): string =>
  shape.subpaths
    .flatMap((subpath) =>
      subpath.commands.map((command) => {
        switch (command.type) {
          case "M":
            return `${fixed(command.x)} ${fixed(command.y)} moveto`;
          case "L":
            return `${fixed(command.x)} ${fixed(command.y)} lineto`;
          case "C":
            return `${fixed(command.x1)} ${fixed(command.y1)} ${fixed(command.x2)} ${fixed(command.y2)} ${fixed(command.x)} ${fixed(command.y)} curveto`;
          case "Z":
            return "closepath";
        }
      }),
    )
    .join("\n");

export const serializeEps = (document: VectorDocument): string => {
  const body = document.shapes
    .map((shape) => {
      const [red, green, blue] = paintRgb(
        shape.fill === "none" ? shape.stroke : shape.fill,
      );
      const composite = ([red, green, blue] as const).map(
        (channel) => channel * shape.opacity + (1 - shape.opacity),
      );
      const operation =
        shape.fill === "none"
          ? `${fixed(shape.strokeWidth)} setlinewidth\nstroke`
          : shape.fillRule === "evenodd"
            ? "eofill"
            : "fill";
      return `newpath\n${epsCommands(shape)}\n${fixed(composite[0])} ${fixed(composite[1])} ${fixed(composite[2])} setrgbcolor\n${operation}`;
    })
    .join("\n");
  return `%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 ${Math.ceil(document.width)} ${Math.ceil(document.height)}\n1 -1 scale\n0 -${fixed(document.height)} translate\n${body}\nshowpage\n%%EOF\n`;
};

interface XY {
  x: number;
  y: number;
}
const pointToLineDistance = (point: XY, start: XY, end: XY): number => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0)
    return Math.hypot(point.x - start.x, point.y - start.y);
  return (
    Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) /
    Math.hypot(dx, dy)
  );
};

const splitCubic = (
  start: XY,
  command: Extract<VectorCommand, { type: "C" }>,
): [
  XY,
  Extract<VectorCommand, { type: "C" }>,
  Extract<VectorCommand, { type: "C" }>,
] => {
  const midpoint = (left: XY, right: XY): XY => ({
    x: (left.x + right.x) / 2,
    y: (left.y + right.y) / 2,
  });
  const p1 = { x: command.x1, y: command.y1 };
  const p2 = { x: command.x2, y: command.y2 };
  const end = { x: command.x, y: command.y };
  const a = midpoint(start, p1);
  const b = midpoint(p1, p2);
  const c = midpoint(p2, end);
  const d = midpoint(a, b);
  const e = midpoint(b, c);
  const split = midpoint(d, e);
  return [
    split,
    { type: "C", x1: a.x, y1: a.y, x2: d.x, y2: d.y, x: split.x, y: split.y },
    { type: "C", x1: e.x, y1: e.y, x2: c.x, y2: c.y, x: end.x, y: end.y },
  ];
};

export const flattenCubicAdaptive = (
  start: XY,
  command: Extract<VectorCommand, { type: "C" }>,
  tolerance = 0.25,
  depth = 0,
): XY[] => {
  const end = { x: command.x, y: command.y };
  const flatness = Math.max(
    pointToLineDistance({ x: command.x1, y: command.y1 }, start, end),
    pointToLineDistance({ x: command.x2, y: command.y2 }, start, end),
  );
  if (flatness <= tolerance || depth >= 16) return [end];
  const [split, left, right] = splitCubic(start, command);
  return [
    ...flattenCubicAdaptive(start, left, tolerance, depth + 1),
    ...flattenCubicAdaptive(split, right, tolerance, depth + 1),
  ];
};

const flatten = (
  commands: VectorCommand[],
): { points: XY[]; closed: boolean } => {
  const points: XY[] = [];
  let current: XY = { x: 0, y: 0 };
  let closed = false;
  for (const command of commands) {
    if (command.type === "M" || command.type === "L") {
      current = { x: command.x, y: command.y };
      points.push(current);
    } else if (command.type === "C") {
      points.push(...flattenCubicAdaptive(current, command));
      current = { x: command.x, y: command.y };
    } else closed = true;
  }
  return { points, closed };
};

export const serializeDxf = (document: VectorDocument): string => {
  const entities = document.shapes
    .flatMap((shape) =>
      shape.subpaths.map((subpath) => {
        const flattened = flatten(subpath.commands);
        const vertices = flattened.points
          .map(
            (point) =>
              `0\nVERTEX\n8\n${shape.id}\n10\n${fixed(point.x)}\n20\n${fixed(document.height - point.y)}\n30\n0`,
          )
          .join("\n");
        return `0\nPOLYLINE\n8\n${shape.id}\n66\n1\n70\n${flattened.closed ? 1 : 0}\n${vertices}\n0\nSEQEND`;
      }),
    )
    .join("\n");
  return `0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}\n0\nENDSEC\n0\nEOF\n`;
};

export const serializePathJson = (document: VectorDocument): string =>
  JSON.stringify(document, null, 2);
