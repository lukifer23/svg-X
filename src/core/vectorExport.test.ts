import { describe, expect, test } from "vitest";
import { serializeDxf, serializeEps, serializePathJson } from "./vectorExport";
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
});
