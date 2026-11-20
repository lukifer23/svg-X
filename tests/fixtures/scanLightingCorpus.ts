import sharp from "sharp";
import { centerlineCorpus, type CenterlineCase } from "./centerlineCorpus";

export interface ScanPair {
  name: string;
  clean: CenterlineCase;
  scan: CenterlineCase["image"];
  distorted: boolean;
}

export const emulateFadedScan = ({
  pixels,
  width,
  height,
}: CenterlineCase["image"]) => {
  const output = pixels.slice();
  let state = 0xd980c311;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const horizontal = x / Math.max(1, width - 1);
      const vertical = y / Math.max(1, height - 1);
      const light =
        122 + 115 * horizontal + 9 * Math.sin(vertical * Math.PI * 2);
      const ink =
        255 -
        (0.2126 * pixels[index] +
          0.7152 * pixels[index + 1] +
          0.0722 * pixels[index + 2]);
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const grain = (state & 255) < 4 ? 28 : ((state >> 8) & 3) - 1;
      const tone = Math.round(light - ink * (0.16 + 0.16 * vertical) - grain);
      output.fill(Math.max(0, Math.min(255, tone)), index, index + 3);
    }
  }
  return { pixels: output, width, height };
};

export const scanLightingCorpus = async (): Promise<ScanPair[]> => {
  const source = await centerlineCorpus();
  const width = 208;
  const height = 120;
  const ellipses = [
    [52, 58, 37, 35],
    [52, 58, 42, 40],
    [153, 63, 31, 24],
  ];
  const markup = ellipses
    .map(
      ([cx, cy, rx, ry]) =>
        `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/>`,
    )
    .join("");
  const draw = async (paperOnly: boolean) =>
    new Uint8ClampedArray(
      await sharp(
        Buffer.from(
          `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><g fill="none" stroke="black" stroke-width="2.5">${paperOnly ? "" : markup}</g></svg>`,
        ),
      )
        .ensureAlpha()
        .raw()
        .toBuffer(),
    );
  const cleanLoops = { pixels: await draw(false), width, height };
  const scan = emulateFadedScan(cleanLoops);
  const empty = emulateFadedScan({ pixels: await draw(true), width, height });
  // Narrow faded arcs retain weak ink. One of them crosses the annular
  // corridor shared by two nearby loops.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!(
        (x >= 37 && x <= 42 && y < 40) ||
        (x >= 73 && x <= 78 && y > 73) ||
        (y >= 53 && y <= 57 && x >= 173)
      ))
        continue;
      const i = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1)
        scan.pixels[i + channel] = Math.round(
          empty.pixels[i + channel] -
            0.18 * (empty.pixels[i + channel] - scan.pixels[i + channel]),
        );
    }
  }
  const curved = {
    name: "curved-loops-faded",
    clean: {
      name: "curved-loops",
      image: cleanLoops,
      reference: ellipses.map(([cx, cy, rx, ry]) =>
        Array.from({ length: 361 }, (_, i) => ({
          x: cx + rx * Math.cos((i * Math.PI) / 180),
          y: cy + ry * Math.sin((i * Math.PI) / 180),
        })),
      ),
      topology: { tips: 0, junctions: 0, loops: 3 },
    },
    scan,
    distorted: true,
  };
  return source
    .filter(
      ({ name }) =>
        name === "close-parallel" ||
        name === "junctions" ||
        name === "mechanism-artwork" ||
        name.endsWith("-patent-scan"),
    )
    .flatMap((clean) => [
      ...(clean.reference || clean.name === "mechanism-artwork"
        ? []
        : [{ name: clean.name, clean, scan: clean.image, distorted: false }]),
      {
        name: `${clean.name}-faded`,
        clean,
        scan: emulateFadedScan(clean.image),
        distorted: true,
      },
    ])
    .concat(curved);
};
