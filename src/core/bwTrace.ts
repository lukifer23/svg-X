import {
  getPaths,
  traceImageData,
  type PathSegment,
  type PotraceOptions,
} from "@cadit-app/potrace-ts";
import type {
  VectorDocument,
  VectorSubpath,
  WorkerConversionOptions,
} from "./vectorDocument";

const mirrorPixels = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray => {
  const mirrored = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 4;
      const target = (y * width + (width - x - 1)) * 4;
      mirrored.set(pixels.subarray(source, source + 4), target);
    }
  }
  return mirrored;
};

const preparePixels = (
  source: Uint8ClampedArray,
  width: number,
  height: number,
  options: WorkerConversionOptions,
): { pixels: Uint8ClampedArray; mirrored: boolean } => {
  const shouldInvert = options.invert || !options.blackOnWhite;
  const output =
    options.turnPolicy === "left"
      ? mirrorPixels(source, width, height)
      : new Uint8ClampedArray(source);

  for (let index = 0; index < output.length; index += 4) {
    const alpha = output[index + 3] / 255;
    const red = Math.round(output[index] * alpha + 255 * (1 - alpha));
    const green = Math.round(output[index + 1] * alpha + 255 * (1 - alpha));
    const blue = Math.round(output[index + 2] * alpha + 255 * (1 - alpha));
    output[index] = shouldInvert ? 255 - red : red;
    output[index + 1] = shouldInvert ? 255 - green : green;
    output[index + 2] = shouldInvert ? 255 - blue : blue;
    output[index + 3] = 255;
  }
  return { pixels: output, mirrored: options.turnPolicy === "left" };
};

const toSubpath = (
  segments: PathSegment[],
  width: number,
  mirrored: boolean,
): VectorSubpath | null => {
  if (segments.length === 0) return null;
  const mapX = (x: number): number => (mirrored ? width - x : x);
  const commands: VectorSubpath["commands"] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment.type === "POINT") {
      commands.push({
        type: index === 0 ? "M" : "L",
        x: mapX(segment.x),
        y: segment.y,
      });
    } else {
      commands.push({
        type: "C",
        x1: mapX(segment.x1),
        y1: segment.y1,
        x2: mapX(segment.x2),
        y2: segment.y2,
        x: mapX(segment.x),
        y: segment.y,
      });
    }
  }
  commands.push({ type: "Z" });
  return { commands, closed: true };
};

export const traceBlackAndWhite = (
  source: Uint8ClampedArray,
  width: number,
  height: number,
  options: WorkerConversionOptions,
): VectorDocument => {
  const prepared = preparePixels(source, width, height, options);
  const potraceOptions: Partial<PotraceOptions> = {
    turnpolicy: options.turnPolicy === "left" ? "right" : options.turnPolicy,
    turdsize: options.turdSize,
    optcurve: options.optCurve,
    alphamax: options.alphaMax,
    opttolerance: options.optTolerance,
  };
  const traced = traceImageData(
    { data: prepared.pixels, width, height },
    potraceOptions,
    options.threshold,
  );
  const subpaths = getPaths(traced)
    .map((path) => toSubpath(path, width, prepared.mirrored))
    .filter((path): path is VectorSubpath => path !== null);

  const background =
    options.backgroundColor === "transparent"
      ? []
      : [
          {
            id: "bw-background",
            fill: options.backgroundColor,
            stroke: "none",
            strokeWidth: 0,
            opacity: 1,
            fillRule: "nonzero" as const,
            subpaths: [
              {
                closed: true,
                commands: [
                  { type: "M" as const, x: 0, y: 0 },
                  { type: "L" as const, x: width, y: 0 },
                  { type: "L" as const, x: width, y: height },
                  { type: "L" as const, x: 0, y: height },
                  { type: "Z" as const },
                ],
              },
            ],
          },
        ];

  return {
    version: 1,
    width,
    height,
    mode: "bw",
    shapes: [
      ...background,
      ...(subpaths.length === 0
        ? []
        : [
            {
              id: "bw-foreground",
              fill: options.foregroundColor,
              stroke: "none",
              strokeWidth: 0,
              opacity: 1,
              fillRule: "evenodd" as const,
              subpaths,
            },
          ]),
    ],
  };
};
