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
      const operation =
        shape.fill === "none"
          ? `${fixed(shape.strokeWidth)} setlinewidth\nstroke`
          : shape.fillRule === "evenodd"
            ? "eofill"
            : "fill";
      return `newpath\n${epsCommands(shape)}\n${fixed(red)} ${fixed(green)} ${fixed(blue)} setrgbcolor\n${operation}`;
    })
    .join("\n");
  return `%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 ${Math.ceil(document.width)} ${Math.ceil(document.height)}\n1 -1 scale\n0 -${fixed(document.height)} translate\n${body}\nshowpage\n%%EOF\n`;
};

interface XY {
  x: number;
  y: number;
}
const cubicPoint = (
  start: XY,
  command: Extract<VectorCommand, { type: "C" }>,
  t: number,
): XY => {
  const u = 1 - t;
  return {
    x:
      u ** 3 * start.x +
      3 * u ** 2 * t * command.x1 +
      3 * u * t ** 2 * command.x2 +
      t ** 3 * command.x,
    y:
      u ** 3 * start.y +
      3 * u ** 2 * t * command.y1 +
      3 * u * t ** 2 * command.y2 +
      t ** 3 * command.y,
  };
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
      for (let step = 1; step <= 12; step += 1)
        points.push(cubicPoint(current, command, step / 12));
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
