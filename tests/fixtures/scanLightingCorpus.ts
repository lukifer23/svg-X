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
    ]);
};
