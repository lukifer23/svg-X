import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [sourceDirectory, datasetDirectory, ...extra] = process.argv.slice(2);
if (!sourceDirectory || !datasetDirectory || extra.length)
  throw new Error(
    "Usage: node scripts/build-restoration-corpus.mjs new-source-dir new-dataset-dir",
  );

const circle = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}"/>`;
const line = (d) => `<path d="${d}"/>`;
const rect = (x, y, w, h, r = 0) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`;
const families = {
  wheel: (n) => {
    const r = 48 + 2 * n;
    const spokes = 5 + (n % 4);
    return (
      circle(140, 118, r) +
      circle(140, 118, r - 4) +
      circle(140, 118, 11) +
      Array.from({ length: spokes }, (_, i) => {
        const t = (i * 2 * Math.PI) / spokes;
        return line(
          `M${140 + Math.cos(t) * 11} ${118 + Math.sin(t) * 11} L${140 + Math.cos(t) * (r - 4)} ${118 + Math.sin(t) * (r - 4)}`,
        );
      }).join("")
    );
  },
  pipe: (n) =>
    line(
      `M12 180 H${80 + n * 3} Q130 180 130 135 V81 Q130 35 169 35 H265 M12 189 H${80 + n * 3} Q139 189 139 135 V81 Q139 44 169 44 H265 M12 180V189 M265 35V44`,
    ) +
    rect(56 + n * 4, 172, 14, 25) +
    circle(188, 40, 16),
  wiring: (n) =>
    rect(100, 75, 75, 90, 2) +
    Array.from({ length: 5 }, (_, i) => {
      const y = 84 + i * 17;
      return (
        circle(22, y + 15, 3) +
        circle(252, y - 22, 3) +
        line(
          `M25 ${y + 15} H${36 + i * 8 + n} V${y} H100 M175 ${y} H${223 - i * 7 + n} V${y - 22} H249`,
        )
      );
    }).join(""),
  grid: (n) =>
    rect(32, 45, 220, 142) +
    Array.from({ length: 5 }, (_, i) =>
      line(`M${52 + i * (34 + n)} 45 V187 M32 ${66 + i * (16 + n / 3)} H252`),
    ).join(""),
  linkage: (n) =>
    circle(60, 152, 19) +
    circle(60, 152, 5) +
    circle(137 + n * 5, 69, 17) +
    circle(137 + n * 5, 69, 5) +
    line(
      `M49 137 L${124 + n * 5} 54 M71 137 L${127 + n * 5} 83 M${152 + n * 5} 73 L233 123 L231 139 L${145 + n * 5} 86 M29 181 H97`,
    ),
  housing: (n) =>
    rect(48, 46, 181, 150, 10 + n) +
    rect(55, 53, 167, 136, 7 + n) +
    rect(83, 81, 113, 80, 8) +
    [69, 205]
      .flatMap((x) => [67, 178].map((y) => circle(x, y, 3 + n / 8)))
      .join(""),
  flange: (n) =>
    circle(140, 118, 74) +
    circle(140, 118, 27 + n) +
    Array.from({ length: 6 + (n % 3) }, (_, i) => {
      const t = (i * 2 * Math.PI) / (6 + (n % 3));
      return circle(140 + Math.cos(t) * 54, 118 + Math.sin(t) * 54, 4 + n / 6);
    }).join(""),
  channel: (n) =>
    line(
      `M23 62 H245 V96 H${156 + n * 3} V163 H94 V130 H23 Z M32 71H236V87H${146 + n * 3}V154H103V121H32 Z`,
    ) + [48, 72, 104, 130].map((x) => line(`M${x} 56v9 M${x} 128v10`)).join(""),
  "pin-array": (n) =>
    rect(52, 45, 170, 146, 14) +
    Array.from({ length: 4 }, (_, row) =>
      Array.from({ length: 7 }, (_, column) =>
        circle(69 + column * 22, 68 + row * (26 + n / 3), 3 + ((row + n) % 4)),
      ).join(""),
    ).join("") +
    line("M137 40 V196 M44 116 H230"),
};

await mkdir(sourceDirectory);
const items = [];
for (const [family, geometry] of Object.entries(families)) {
  for (let design = 0; design < 12; design += 1) {
    const svg = `${family}-${design}.svg`;
    const weight = 0.85 + (design % 5) * 0.33;
    const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="240" viewBox="0 0 280 240"><g fill="none" stroke="#181818" stroke-width="${weight}" stroke-linecap="round" stroke-linejoin="round" transform="rotate(${(design % 7) - 3} 140 120)">${geometry(design)}</g></svg>`;
    await writeFile(path.join(sourceDirectory, svg), markup, { flag: "wx" });
    items.push({ svg, group: `svgx-pilot-${family}`, license: "MIT" });
  }
}
const manifest = path.join(sourceDirectory, "manifest.json");
await writeFile(
  path.join(sourceDirectory, "SVG-X-LICENSE.txt"),
  await readFile(new URL("../LICENSE", import.meta.url)),
);
await writeFile(
  manifest,
  JSON.stringify(
    {
      seed: "svgx-restoration-pilot-1",
      variants: 4,
      maxDimension: 512,
      notices: ["SVG-X-LICENSE.txt"],
      items,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
execFileSync(
  process.execPath,
  [
    fileURLToPath(new URL("./build-training-dataset.mjs", import.meta.url)),
    manifest,
    datasetDirectory,
  ],
  { stdio: "inherit" },
);
