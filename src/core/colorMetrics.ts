export type Lab = readonly [number, number, number];

const toLinear = (channel: number): number => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

export const rgbToLab = (red: number, green: number, blue: number): Lab => {
  const r = toLinear(red);
  const g = toLinear(green);
  const b = toLinear(blue);
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
  const pivot = (value: number): number =>
    value > 216 / 24_389
      ? Math.cbrt(value)
      : ((24_389 / 27) * value) / 116 + 16 / 116;
  const fx = pivot(x);
  const fy = pivot(y);
  const fz = pivot(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};

const degrees = (radians: number): number => (radians * 180) / Math.PI;
const radians = (angle: number): number => (angle * Math.PI) / 180;
const hue = (a: number, b: number): number => {
  const value = degrees(Math.atan2(b, a));
  return value >= 0 ? value : value + 360;
};

/** CIEDE2000 using the Sharma-Wu-Dalal reference formulation. */
export const deltaE00 = (left: Lab, right: Lab): number => {
  const [l1, a1, b1] = left;
  const [l2, a2, b2] = right;
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cBar = (c1 + c2) / 2;
  const cBar7 = cBar ** 7;
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + 25 ** 7)));
  const a1Prime = (1 + g) * a1;
  const a2Prime = (1 + g) * a2;
  const c1Prime = Math.hypot(a1Prime, b1);
  const c2Prime = Math.hypot(a2Prime, b2);
  const h1Prime = hue(a1Prime, b1);
  const h2Prime = hue(a2Prime, b2);
  const deltaLPrime = l2 - l1;
  const deltaCPrime = c2Prime - c1Prime;
  const hueDifference = h2Prime - h1Prime;
  const deltaHAngle =
    c1Prime * c2Prime === 0
      ? 0
      : Math.abs(hueDifference) <= 180
        ? hueDifference
        : hueDifference > 180
          ? hueDifference - 360
          : hueDifference + 360;
  const deltaHPrime =
    2 * Math.sqrt(c1Prime * c2Prime) * Math.sin(radians(deltaHAngle / 2));
  const lBar = (l1 + l2) / 2;
  const cPrimeBar = (c1Prime + c2Prime) / 2;
  const hPrimeBar =
    c1Prime * c2Prime === 0
      ? h1Prime + h2Prime
      : Math.abs(h1Prime - h2Prime) <= 180
        ? (h1Prime + h2Prime) / 2
        : h1Prime + h2Prime < 360
          ? (h1Prime + h2Prime + 360) / 2
          : (h1Prime + h2Prime - 360) / 2;
  const t =
    1 -
    0.17 * Math.cos(radians(hPrimeBar - 30)) +
    0.24 * Math.cos(radians(2 * hPrimeBar)) +
    0.32 * Math.cos(radians(3 * hPrimeBar + 6)) -
    0.2 * Math.cos(radians(4 * hPrimeBar - 63));
  const deltaTheta = 30 * Math.exp(-(((hPrimeBar - 275) / 25) ** 2));
  const cPrimeBar7 = cPrimeBar ** 7;
  const rc = 2 * Math.sqrt(cPrimeBar7 / (cPrimeBar7 + 25 ** 7));
  const sl = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sc = 1 + 0.045 * cPrimeBar;
  const sh = 1 + 0.015 * cPrimeBar * t;
  const rt = -Math.sin(radians(2 * deltaTheta)) * rc;
  const lTerm = deltaLPrime / sl;
  const cTerm = deltaCPrime / sc;
  const hTerm = deltaHPrime / sh;
  return Math.sqrt(lTerm ** 2 + cTerm ** 2 + hTerm ** 2 + rt * cTerm * hTerm);
};

export const meanDeltaE00 = (
  left: Uint8Array,
  right: Uint8Array,
  channels = 3,
): number => {
  if (left.length !== right.length || left.length % channels !== 0)
    throw new Error("Color buffers must have matching complete pixels");
  let total = 0;
  const pixels = left.length / channels;
  for (let offset = 0; offset < left.length; offset += channels) {
    total += deltaE00(
      rgbToLab(left[offset], left[offset + 1], left[offset + 2]),
      rgbToLab(right[offset], right[offset + 1], right[offset + 2]),
    );
  }
  return total / pixels;
};
