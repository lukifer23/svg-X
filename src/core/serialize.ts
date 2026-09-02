import type {
  VectorCommand,
  VectorDocument,
  VectorShape,
} from "./vectorDocument";

const number = (value: number): string => {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
};

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

const safePaint = (value: string): string =>
  /^(?:none|transparent|#[0-9a-f]{3,8}|rgba?\([\d.,%\s]+\))$/i.test(value)
    ? value
    : "none";

export const serializeVectorDocument = (document: VectorDocument): string => {
  const shapes = document.shapes
    .map((shape) => {
      const attributes = [
        `d="${shapePathData(shape)}"`,
        `fill="${safePaint(shape.fill)}"`,
        `stroke="${safePaint(shape.stroke)}"`,
        `fill-rule="${shape.fillRule}"`,
      ];
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
