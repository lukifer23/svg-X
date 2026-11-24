import type {
  VectorCommand,
  VectorDocument,
  VectorShape,
} from "./vectorDocument";

const roundCoordinate = (value: number): number =>
  Math.round(value * 1000) / 1000;

const number = (value: number): string => String(roundCoordinate(value));

const commandToString = (command: VectorCommand): string => {
  switch (command.type) {
    case "M":
    case "L":
      return `${command.type}${number(command.x)} ${number(command.y)}`;
    case "C":
      return `C${number(command.x1)} ${number(command.y1)} ${number(command.x2)} ${number(command.y2)} ${number(command.x)} ${number(command.y)}`;
    case "Z":
      return "Z";
  }
};

export const shapePathData = (shape: VectorShape): string =>
  shape.subpaths
    .flatMap((subpath) => subpath.commands.map(commandToString))
    .join(" ");

const compactNumber = (value: number): string => {
  const text = String(value);
  if (text.startsWith("0.")) return text.slice(1);
  if (text.startsWith("-0.")) return `-${text.slice(2)}`;
  return text;
};

// A minus sign starts a new SVG number without a separator.
const nextNumber = (value: number): string =>
  `${value < 0 ? "" : " "}${compactNumber(value)}`;

const pair = (x: number, y: number): string => compactNumber(x) + nextNumber(y);

const cubicValues = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x: number,
  y: number,
): string =>
  pair(x1, y1) +
  nextNumber(x2) +
  nextNumber(y2) +
  nextNumber(x) +
  nextNumber(y);

const exactOffset = (origin: number, point: number, offset: number): boolean =>
  origin + offset === point &&
  Math.fround(origin + Math.fround(offset)) === Math.fround(point);

const compactPathData = (shape: VectorShape): string => {
  const paths: string[] = [];
  for (const { commands } of shape.subpaths) {
    let result = "";
    let previous = "";
    let x = 0;
    let y = 0;
    let startX = 0;
    let startY = 0;
    const segment = (command: string, values: string): string =>
      command === previous
        ? `${values.startsWith("-") ? "" : " "}${values}`
        : command + values;
    for (const command of commands) {
      if (command.type === "Z") {
        result += "Z";
        previous = "Z";
        x = startX;
        y = startY;
        continue;
      }
      const endX = roundCoordinate(command.x);
      const endY = roundCoordinate(command.y);
      const integerEndpoints =
        Number.isInteger(x) &&
        Number.isInteger(y) &&
        Number.isInteger(endX) &&
        Number.isInteger(endY);
      if (command.type === "M") {
        result += `M${pair(endX, endY)}`;
        previous = "M";
        startX = endX;
        startY = endY;
      } else if (command.type === "C") {
        const x1 = roundCoordinate(command.x1);
        const y1 = roundCoordinate(command.y1);
        const x2 = roundCoordinate(command.x2);
        const y2 = roundCoordinate(command.y2);
        let type = "C";
        let encoded = segment(type, cubicValues(x1, y1, x2, y2, endX, endY));
        // Integer anchors do not accumulate rounding across curves. Check
        // that both float and double readers reconstruct the same controls.
        if (integerEndpoints) {
          const dx1 = roundCoordinate(x1 - x);
          const dy1 = roundCoordinate(y1 - y);
          const dx2 = roundCoordinate(x2 - x);
          const dy2 = roundCoordinate(y2 - y);
          if (
            exactOffset(x, x1, dx1) &&
            exactOffset(y, y1, dy1) &&
            exactOffset(x, x2, dx2) &&
            exactOffset(y, y2, dy2)
          ) {
            const relative = segment(
              "c",
              cubicValues(dx1, dy1, dx2, dy2, endX - x, endY - y),
            );
            if (relative.length < encoded.length) {
              type = "c";
              encoded = relative;
            }
          }
        }
        result += encoded;
        previous = type;
      } else {
        let type = endY === y ? "H" : endX === x ? "V" : "L";
        let encoded = segment(
          type,
          type === "H"
            ? compactNumber(endX)
            : type === "V"
              ? compactNumber(endY)
              : pair(endX, endY),
        );
        // Relative integer moves preserve the rounded endpoints exactly.
        if (integerEndpoints) {
          const relativeType = type.toLowerCase();
          const relative = segment(
            relativeType,
            type === "H"
              ? String(endX - x)
              : type === "V"
                ? String(endY - y)
                : pair(endX - x, endY - y),
          );
          if (relative.length < encoded.length) {
            type = relativeType;
            encoded = relative;
          }
        }
        result += encoded;
        previous = type;
      }
      x = endX;
      y = endY;
    }
    paths.push(result);
  }
  return paths.join("");
};

const safePaint = (value: string): string =>
  /^(?:none|transparent|#[0-9a-f]{3,8}|rgba?\([\d.,%\s]+\))$/i.test(value)
    ? value
    : "none";

const compactPaint = (value: string): string => {
  const paint = safePaint(value);
  const rgb = /^rgb\((\d{1,3}),(\d{1,3}),(\d{1,3})\)$/.exec(paint);
  if (!rgb) return paint;
  const channels = rgb.slice(1).map(Number);
  if (channels.some((channel) => channel > 255)) return paint;
  const hex = channels.map((channel) => channel.toString(16).padStart(2, "0"));
  return hex.every(([high, low]) => high === low)
    ? `#${hex.map(([high]) => high).join("")}`
    : `#${hex.join("")}`;
};

export const serializeVectorDocument = (
  document: VectorDocument,
  { compact = false } = {},
): string => {
  const shapes = document.shapes
    .map((shape) => {
      const attributes = [
        `d="${compact ? compactPathData(shape) : shapePathData(shape)}"`,
        `fill="${compact ? compactPaint(shape.fill) : safePaint(shape.fill)}"`,
      ];
      if (!compact || shape.stroke !== "none")
        attributes.push(`stroke="${safePaint(shape.stroke)}"`);
      attributes.push(`fill-rule="${shape.fillRule}"`);
      if (shape.stroke !== "none")
        attributes.push(
          `stroke-width="${number(shape.strokeWidth)}"`,
          'stroke-linecap="round"',
          'stroke-linejoin="round"',
        );
      if (shape.opacity < 1)
        attributes.push(`opacity="${number(shape.opacity)}"`);
      return `<path ${attributes.join(" ")}/>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${document.width}" height="${document.height}" viewBox="0 0 ${document.width} ${document.height}">${shapes}</svg>`;
};

export const countSubpaths = (document: VectorDocument): number =>
  document.shapes.reduce((total, shape) => total + shape.subpaths.length, 0);
