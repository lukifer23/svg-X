import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { expect, test } from "vitest";
import { traceCenterlines } from "../src/core/centerline";
import { traceColorDocument } from "../src/core/colorTrace";
import { serializeVectorDocument } from "../src/core/serialize";
import {
  serializeDxf,
  serializeEps,
  serializePathJson,
} from "../src/core/vectorExport";
import { centerlineOptions } from "../tests/fixtures/centerlineCorpus";

const run = promisify(execFile);
const verifyCadImport = `
import json
import math
import sys
import ezdxf

with open(sys.argv[1], encoding="utf-8") as source:
    geometry = json.load(source)
drawing = ezdxf.readfile(sys.argv[2])
assert not drawing.audit().errors
paths = [subpath for shape in geometry["shapes"] for subpath in shape["subpaths"]]
polylines = list(drawing.modelspace())
assert len(paths) == len(polylines)
for source, entity in zip(paths, polylines):
    assert entity.dxftype() == "POLYLINE"
    assert entity.is_closed == source["closed"]
    points = [vertex.dxf.location for vertex in entity.vertices]
    assert len(points) >= 2
    checks = [command for command in source["commands"] if command["type"] != "Z"]
    last_index = 0
    for command in checks:
        last_index = next(index for index in range(last_index, len(points))
                          if math.isclose(points[index].x, command["x"], abs_tol=0.000051)
                          and math.isclose(points[index].y, geometry["height"] - command["y"], abs_tol=0.000051))
    assert all(math.isfinite(p.x) and math.isfinite(p.y) for p in points)
print(json.dumps({"width":geometry["width"], "height":geometry["height"], "paths":len(polylines)}))
`;

test
  .runIf(process.env.SVGX_EXPORT_CONSUMERS === "1")
  .each(["color", "centerline"] as const)(
  "independent renderers and CAD importer open real %s exports",
  async (mode) => {
    const filename =
      mode === "color" ? "color-bicycle.png" : "velocipede-patent-scan.png";
    const source = await readFile(
      new URL(`../tests/fixtures/review/${filename}`, import.meta.url),
    );
    const {
      data,
      info: { width, height },
    } = await sharp(source)
      .resize(256, 256, { fit: "inside", withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixels = new Uint8ClampedArray(data);
    const options = {
      ...centerlineOptions,
      mode,
      optCurve: true,
      optTolerance: 0.2,
      normalizeScanLighting: true,
      strokeWidth: 5,
    };
    const trace = mode === "color" ? traceColorDocument : traceCenterlines;
    const document = trace(pixels, width, height, options);
    if (mode === "color")
      expect(document.shapes.some((shape) => shape.subpaths.length > 1)).toBe(
        true,
      );
    const root = await mkdtemp(path.join(tmpdir(), "svgx-export-check-"));
    try {
      const eps = path.join(root, "drawing.eps");
      const dxf = path.join(root, "drawing.dxf");
      const json = path.join(root, "drawing.json");
      const svg = Buffer.from(serializeVectorDocument(document));
      await Promise.all([
        writeFile(eps, serializeEps(document)),
        writeFile(dxf, serializeDxf(document)),
        writeFile(json, serializePathJson(document)),
      ]);
      const { stdout } = await run(
        process.env.SVGX_EXPORT_PYTHON || "python3",
        ["-c", verifyCadImport, json, dxf],
        { timeout: 30_000 },
      );
      expect(JSON.parse(stdout)).toEqual({
        width,
        height,
        paths: document.shapes.reduce(
          (total, shape) => total + shape.subpaths.length,
          0,
        ),
      });
      for (const density of [72, 144, 288]) {
        const raster = path.join(root, "eps.png");
        await run(
          "gs",
          [
            "-dSAFER",
            "-dBATCH",
            "-dNOPAUSE",
            "-dEPSCrop",
            "-dGraphicsAlphaBits=4",
            "-sDEVICE=png16m",
            `-r${density}`,
            `-sOutputFile=${raster}`,
            eps,
          ],
          { timeout: 30_000 },
        );
        const reference = await sharp(svg, { density })
          .flatten({ background: "#ffffff" })
          .removeAlpha()
          .raw()
          .toBuffer();
        const { data: rendered, info } = await sharp(raster)
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        expect([info.width, info.height]).toEqual([
          (width * density) / 72,
          (height * density) / 72,
        ]);
        expect(rendered).toHaveLength(reference.length);
        let different = 0;
        let total = 0;
        for (let i = 0; i < reference.length; i += 3) {
          const error = Math.max(
            Math.abs(reference[i] - rendered[i]),
            Math.abs(reference[i + 1] - rendered[i + 1]),
            Math.abs(reference[i + 2] - rendered[i + 2]),
          );
          different += Number(error > 32);
          total += error;
        }
        const count = reference.length / 3;
        console.log(
          `${mode} at ${density} DPI: ${((different / count) * 100).toFixed(2)}% pixels differ by >32, mean max-channel error ${(total / count).toFixed(2)}`,
        );
        expect(different / count).toBeLessThan(0.07);
        expect(total / count).toBeLessThan(6);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  120_000,
);
