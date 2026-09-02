import { DEFAULT_PARAMS, type TracingParams } from "./imageProcessor";

export const SETTINGS_STORAGE_KEY = "svgx-settings-v3";
export const PREVIOUS_SETTINGS_STORAGE_KEY = "svgx-settings-v2";
export const LEGACY_SETTINGS_STORAGE_KEY = "svgx-potrace-params";

const turnPolicies = new Set([
  "black",
  "white",
  "left",
  "right",
  "minority",
  "majority",
]);
const fillStrategies = new Set(["dominant", "mean", "median", "spread"]);
const conversionModes = new Set(["bw", "color", "centerline"]);

const finite = (
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback;
const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;
const paint = (value: unknown, fallback: string): string =>
  typeof value === "string" && /^(?:transparent|#[0-9a-f]{3,8})$/i.test(value)
    ? value
    : fallback;

export const normalizeSettings = (input: unknown): TracingParams => {
  const value =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  return {
    mode: conversionModes.has(String(value.mode))
      ? (value.mode as TracingParams["mode"])
      : value.strokeMode === true
        ? "centerline"
        : value.colorMode === true
          ? "color"
          : DEFAULT_PARAMS.mode,
    turdSize: finite(value.turdSize, DEFAULT_PARAMS.turdSize, 0, 10_000),
    turnPolicy: turnPolicies.has(String(value.turnPolicy))
      ? (value.turnPolicy as TracingParams["turnPolicy"])
      : DEFAULT_PARAMS.turnPolicy,
    alphaMax: finite(value.alphaMax, DEFAULT_PARAMS.alphaMax, 0, 2),
    optCurve: bool(value.optCurve, DEFAULT_PARAMS.optCurve),
    optTolerance: finite(
      value.optTolerance,
      DEFAULT_PARAMS.optTolerance,
      0,
      20,
    ),
    threshold: finite(value.threshold, DEFAULT_PARAMS.threshold, 0, 255),
    blackOnWhite: bool(value.blackOnWhite, DEFAULT_PARAMS.blackOnWhite),
    color: paint(value.color, DEFAULT_PARAMS.color),
    background: paint(value.background, DEFAULT_PARAMS.background),
    invert: bool(value.invert, DEFAULT_PARAMS.invert),
    highestQuality: bool(value.highestQuality, DEFAULT_PARAMS.highestQuality),
    colorSteps: finite(value.colorSteps, DEFAULT_PARAMS.colorSteps, 2, 64),
    colorCurveFit: bool(value.colorCurveFit, DEFAULT_PARAMS.colorCurveFit),
    fillStrategy: fillStrategies.has(String(value.fillStrategy))
      ? (value.fillStrategy as TracingParams["fillStrategy"])
      : DEFAULT_PARAMS.fillStrategy,
    strokeWidth: finite(
      value.strokeWidth,
      DEFAULT_PARAMS.strokeWidth,
      0.1,
      100,
    ),
    centerlineCurveFit: bool(
      value.centerlineCurveFit,
      DEFAULT_PARAMS.centerlineCurveFit,
    ),
    maxPaths: finite(value.maxPaths, DEFAULT_PARAMS.maxPaths, 1, 100_000),
    svgoOptimize: bool(value.svgoOptimize, DEFAULT_PARAMS.svgoOptimize),
  };
};

export const loadSettings = (
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
): TracingParams => {
  try {
    const current = storage.getItem(SETTINGS_STORAGE_KEY);
    if (current) return normalizeSettings(JSON.parse(current));
    const previous =
      storage.getItem(PREVIOUS_SETTINGS_STORAGE_KEY) ??
      storage.getItem(LEGACY_SETTINGS_STORAGE_KEY);
    if (previous) {
      const migrated = normalizeSettings(JSON.parse(previous));
      storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(migrated));
      storage.removeItem(PREVIOUS_SETTINGS_STORAGE_KEY);
      storage.removeItem(LEGACY_SETTINGS_STORAGE_KEY);
      return migrated;
    }
  } catch {
    return { ...DEFAULT_PARAMS };
  }
  return { ...DEFAULT_PARAMS };
};
