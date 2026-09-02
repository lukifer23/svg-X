import { describe, expect, test } from "vitest";
import { DEFAULT_PARAMS } from "./imageProcessor";
import {
  LEGACY_SETTINGS_STORAGE_KEY,
  PREVIOUS_SETTINGS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  loadSettings,
  normalizeSettings,
} from "./settings";

const memoryStorage = (seed: Record<string, string> = {}) => {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    values,
  };
};

describe("settings migration", () => {
  test("migrates supported legacy preferences into the versioned key", () => {
    const storage = memoryStorage({
      [LEGACY_SETTINGS_STORAGE_KEY]: JSON.stringify({
        colorMode: true,
        colorSteps: 7,
        threshold: 170,
      }),
    });
    const result = loadSettings(storage);
    expect(result).toMatchObject({
      mode: "color",
      colorSteps: 7,
      threshold: 170,
    });
    expect(storage.values.has(SETTINGS_STORAGE_KEY)).toBe(true);
    expect(storage.values.has(LEGACY_SETTINGS_STORAGE_KEY)).toBe(false);
  });

  test("rejects stale types and clamps unsafe numeric values", () => {
    expect(
      normalizeSettings({
        threshold: 999,
        turnPolicy: "sideways",
        optCurve: "yes",
        color: "url(evil)",
      }),
    ).toMatchObject({
      threshold: 255,
      turnPolicy: DEFAULT_PARAMS.turnPolicy,
      optCurve: DEFAULT_PARAMS.optCurve,
      color: DEFAULT_PARAMS.color,
    });
  });

  test("migrates v2 boolean mode flags to one authoritative mode", () => {
    const storage = memoryStorage({
      [PREVIOUS_SETTINGS_STORAGE_KEY]: JSON.stringify({
        colorMode: true,
        strokeMode: true,
      }),
    });
    expect(loadSettings(storage).mode).toBe("centerline");
    expect(storage.values.has(PREVIOUS_SETTINGS_STORAGE_KEY)).toBe(false);
  });
});
