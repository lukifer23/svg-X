import { describe, expect, test } from "vitest";
import {
  flattenCubicAdaptive,
  serializeDxf,
  serializeEps,
  serializePathJson,
} from "./vectorExport";
import type { VectorDocument } from "./vectorDocument";

const document: VectorDocument = {
  version: 1,
  width: 20,
  height: 10,
  mode: "color",
  shapes: [
    {
      id: "red-shape",
      fill: "#ff0000",
      stroke: "none",
      strokeWidth: 0,
      opacity: 1,
      fillRule: "evenodd",
      subpaths: [
        {
          closed: true,
          commands: [
            { type: "M", x: 1, y: 1 },
            { type: "C", x1: 4, y1: 0, x2: 8, y2: 0, x: 9, y: 3 },
            { type: "L", x: 1, y: 3 },
            { type: "Z" },
          ],
        },
      ],
    },
  ],
};

describe("VectorDocument exports", () => {
  test("serializes EPS without reparsing SVG", () => {
    const eps = serializeEps(document);
    expect(eps).toContain("%%BoundingBox: 0 0 20 10");
    expect(eps).toContain("curveto");
    expect(eps).toContain("1 0 0 setrgbcolor");
  });

  test("serializes DXF entities and authoritative JSON commands", () => {
    expect(serializeDxf(document)).toContain("POLYLINE");
    expect(JSON.parse(serializePathJson(document))).toEqual(document);
  });

  test("flattens DXF curves according to geometric tolerance", () => {
    const curve = {
      type: "C" as const,
      x1: 0,
      y1: 10,
      x2: 10,
      y2: 10,
      x: 10,
      y: 0,
    };
    const coarse = flattenCubicAdaptive({ x: 0, y: 0 }, curve, 2);
    const fine = flattenCubicAdaptive({ x: 0, y: 0 }, curve, 0.05);
    expect(fine.length).toBeGreaterThan(coarse.length);
    expect(fine[fine.length - 1]).toEqual({ x: 10, y: 0 });
  });

  test("composites EPS opacity deterministically over white", () => {
    const eps = serializeEps({
      ...document,
      shapes: [{ ...document.shapes[0], opacity: 0.5 }],
    });
    expect(eps).toContain("1 0.5 0.5 setrgbcolor");
  });
});
