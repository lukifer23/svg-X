import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const security = require("../../desktop/security.cjs") as {
  isAllowedNavigation: (candidate: string, origins: Set<string>) => boolean;
  safeChild: (root: string, name: string) => string;
  validateText: (content: unknown, maximumBytes: number) => void;
};

describe("desktop trust boundaries", () => {
  const origins = new Set(["http://localhost:3001"]);

  test("allows only the exact configured origin", () => {
    expect(
      security.isAllowedNavigation("http://localhost:3001/settings", origins),
    ).toBe(true);
    for (const hostile of [
      "http://localhost:3001@evil.example/",
      "http://localhost:3001.evil.example/",
      "https://localhost:3001/",
      "javascript:alert(1)",
      "not a URL",
    ]) {
      expect(security.isAllowedNavigation(hostile, origins)).toBe(false);
    }
  });

  test("keeps child names inside the granted root", () => {
    const root = path.resolve("fixtures", "output");
    expect(security.safeChild(root, "drawing.svg")).toBe(
      path.join(root, "drawing.svg"),
    );
    for (const hostile of ["../secret.svg", "folder/secret.svg", "a\0.svg"])
      expect(() => security.safeChild(root, hostile)).toThrow();
  });

  test("enforces output type and encoded byte limits", () => {
    expect(() => security.validateText("é", 2)).not.toThrow();
    expect(() => security.validateText("é", 1)).toThrow(/limit/);
    expect(() => security.validateText(new Uint8Array(), 10)).toThrow(/limit/);
  });
});
