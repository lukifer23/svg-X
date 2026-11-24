import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const fixture = path.resolve("tests/fixtures/review/color-bicycle.png");

const renderedPreview = async (page: Page) => {
  const preview = page.getByRole("img", { name: "Converted SVG preview" });
  await expect(preview).toBeVisible();
  return preview.evaluate(async (image: HTMLImageElement) => {
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight)
      throw new Error("SVG preview did not decode");
    return (await fetch(image.currentSrc)).text();
  });
};

test("uploads, converts, changes mode, and exports real geometry", async ({
  page,
}) => {
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Drop zone/ }).click();
  await (await chooser).setFiles(fixture);
  await expect(page.getByText("Conversion complete!")).toBeVisible();
  expect(await renderedPreview(page)).toContain("<path");

  const modes = page.getByRole("group", { name: "Conversion mode" });
  await modes.getByRole("button", { name: "Color", exact: true }).click();
  await expect(page.getByText("Conversion complete!")).toBeVisible();
  await expect(modes.getByRole("button", { name: "Color" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const polygon = await renderedPreview(page);
  expect(polygon).toContain('fill-rule="evenodd"');
  expect(polygon).not.toMatch(/<path[^>]*\bd="[^"]*[Cc]/);

  await page
    .getByRole("combobox", { name: "Color path style" })
    .selectOption("bezier");
  await expect(page.getByText("Conversion complete!")).toBeVisible();
  const svg = await renderedPreview(page);
  expect(svg).toContain('fill-rule="evenodd"');
  expect(svg).toMatch(/<path[^>]*\bd="[^"]*[Cc]/);
  for (const variant of [polygon, svg]) {
    const distinctFills = await page.evaluate((markup) => {
      const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
      return new Set(
        [...parsed.querySelectorAll("path[fill]")].map((path) =>
          path.getAttribute("fill"),
        ),
      ).size;
    }, variant);
    expect(distinctFills).toBeGreaterThanOrEqual(4);
  }

  const sourceTrigger = page.getByRole("button", { name: "View SVG source" });
  await sourceTrigger.focus();
  await sourceTrigger.press("Enter");
  const sourceDialog = page.getByRole("dialog", { name: "SVG Source" });
  const closeSource = sourceDialog.getByRole("button", { name: /Close SVG/ });
  await expect(closeSource).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(sourceDialog.getByLabel("SVG markup")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(sourceDialog).toBeHidden();
  await expect(sourceTrigger).toBeFocused();

  const logsTrigger = page.getByRole("button", {
    name: "View Processing Logs",
  });
  await logsTrigger.focus();
  await logsTrigger.click();
  await expect(
    page.getByRole("dialog", { name: "Processing Logs" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Processing Logs" }),
  ).toBeHidden();
  await expect(logsTrigger).toBeFocused();

  const convertedAxe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    convertedAxe.violations.filter(
      ({ impact }) => impact === "critical" || impact === "serious",
    ),
  ).toEqual([]);

  const svgDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download SVG" }).click();
  const file = await svgDownload;
  expect(file.suggestedFilename()).toMatch(/\.svg$/);
  expect(await readFile(await file.path(), "utf8")).toBe(svg);

  const exportTrigger = page.getByRole("button", {
    name: "More export formats",
  });
  await exportTrigger.focus();
  await exportTrigger.press("Enter");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "SVG", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(exportTrigger).toBeFocused();
  await expect(exportTrigger).toHaveAttribute("aria-expanded", "false");
  await exportTrigger.click();
  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: /JSON/ }).click();
  expect((await jsonDownload).suggestedFilename()).toMatch(/\.json$/);

  for (const [format, signature] of [
    ["EPS", /^%!PS-Adobe-[\s\S]*moveto/],
    ["DXF", /\nENTITIES\n[\s\S]*\nPOLYLINE\n/],
  ] as const) {
    await exportTrigger.click();
    const action = page.getByRole("button", { name: format, exact: true });
    await expect(action).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      action.click(),
    ]);
    expect(download.suggestedFilename()).toMatch(
      new RegExp(`\\.${format.toLowerCase()}$`),
    );
    expect(await readFile(await download.path(), "utf8")).toMatch(signature);
  }
});

test("traces archived linework as stroked curves through the centerline controls", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings panel" }).click();
  await page.getByRole("radio", { name: /Centerline/ }).click();
  const suppression = page.getByRole("slider", { name: "Speckle Suppression" });
  await suppression.focus();
  await suppression.press("Home");
  await expect(suppression).toHaveValue("0");
  await page
    .getByRole("checkbox", { name: "Fit bounded Bezier curves" })
    .check();
  await page
    .getByRole("checkbox", { name: "Recover faded scan lines" })
    .check();
  await page.getByRole("button", { name: "Close settings panel" }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles(
      path.resolve("tests/fixtures/review/wright-patent-scan.png"),
    );
  await expect(page.getByText("Conversion complete!")).toBeVisible();
  const svg = await renderedPreview(page);
  expect(svg).toContain('stroke-linecap="round"');
  expect(svg).toMatch(/<path[^>]*\bd="[^"]*[Cc]/);
});

test("batch and interactive color workers preserve export geometry and match SVG", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const result = await page.evaluate(async () => {
    const { DEFAULT_PARAMS, processImageBatch, processImageDetailed } =
      await import("/src/utils/imageProcessor.ts");
    const { serializeDxf, serializeEps, serializePathJson } =
      await import("/src/core/vectorExport.ts");
    const response = await fetch(
      "/tests/fixtures/review/usda-fresh-produce.jpg",
    );
    if (!response.ok) throw new Error("Could not load the produce photo");
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 400;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const { data, width, height } = context.getImageData(
      0,
      0,
      canvas.width,
      canvas.height,
    );
    const input = () => ({ pixels: data.slice().buffer, width, height });
    const params = {
      ...DEFAULT_PARAMS,
      mode: "color" as const,
      colorCurveFit: true,
      svgoOptimize: false,
    };
    const interactive = await processImageDetailed(input(), params, () => {});
    const batch = await processImageBatch(input(), params);
    const compactParams = { ...params, svgoOptimize: true };
    const compact = await processImageDetailed(
      input(),
      compactParams,
      () => {},
    );
    const compactBatch = await processImageBatch(input(), compactParams);
    const formatsMatch = await Promise.all(
      (
        [
          ["eps", serializeEps],
          ["dxf", serializeDxf],
          ["json", serializePathJson],
        ] as const
      ).map(
        async ([format, serialize]) =>
          (await processImageBatch(
            input(),
            compactParams,
            undefined,
            format,
          )) === serialize(compact.document),
      ),
    );
    return {
      identical: batch === interactive.svg,
      identicalCompact: compactBatch === compact.svg,
      identicalGeometry:
        JSON.stringify(compact.document) ===
        JSON.stringify(interactive.document),
      smaller: compact.svg.length < interactive.svg.length,
      formatsMatch,
      paths: interactive.metrics.outputPaths,
    };
  });
  expect(result.identical).toBe(true);
  expect(result.identicalCompact).toBe(true);
  expect(result.identicalGeometry).toBe(true);
  expect(result.smaller).toBe(true);
  expect(result.formatsMatch).toEqual([true, true, true]);
  expect(result.paths).toBeGreaterThan(0);
});

test("supports keyboard-safe network dialog and has no serious axe findings", async ({
  page,
}) => {
  await page.goto("/");
  const trigger = page.getByRole("button", {
    name: "Open network access information",
  });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Network access" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Network access" }),
  ).toBeHidden();
  await expect(trigger).toBeFocused();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    results.violations.filter(
      ({ impact }) => impact === "critical" || impact === "serious",
    ),
  ).toEqual([]);
});

test("cancels active production work and recovers for the next conversion", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings panel" }).click();
  await page.getByRole("radio", { name: /Color/ }).click();
  await page.getByRole("button", { name: "Close settings panel" }).click();
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(
    path.resolve("tests/fixtures/review/realistic-still-life.png"),
  );
  const cancel = page.getByRole("button", { name: "Cancel Processing" });
  await expect(cancel).toBeVisible({ timeout: 10_000 });
  await cancel.evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByText("Conversion cancelled.")).toBeVisible();

  await page.getByRole("button", { name: "Upload New Image" }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.resolve("tests/fixtures/formats/artwork.jpg"));
  await expect(page.getByText("Conversion complete!")).toBeVisible({
    timeout: 60_000,
  });
  expect(await renderedPreview(page)).toContain("<path");
});

test("discarding an in-flight upload restores the clean upload screen", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings panel" }).click();
  await page.getByRole("radio", { name: /Color/ }).click();
  await page.getByRole("button", { name: "Close settings panel" }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles(
      path.resolve("tests/fixtures/review/realistic-still-life.png"),
    );
  await expect(
    page.getByRole("button", { name: "Cancel Processing" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Upload New Image" })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole("button", { name: /Drop zone/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "View Processing Logs" }),
  ).toBeHidden();
  await expect(page.getByText("Conversion cancelled.")).toBeHidden();
  await expect(page.getByRole("button", { name: "Download SVG" })).toBeHidden();
});

test("can cancel real SVG optimization before the preview is delivered", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Exercise the high-resolution worker against Chromium's main-thread scheduling",
  );
  await page.addInitScript(() => {
    localStorage.setItem(
      "svgx-settings-v3",
      JSON.stringify({
        mode: "color",
        colorCurveFit: true,
        highestQuality: true,
      }),
    );
  });
  await page.goto("/");
  await page.evaluate(() => {
    const observe = new MutationObserver(() => {
      const optimizing = [...document.querySelectorAll('[role="status"]')].some(
        (status) => status.textContent?.includes("Optimizing SVG output"),
      );
      if (!optimizing) return;
      const cancel = [...document.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Cancel Processing",
      );
      if (!cancel) return;
      observe.disconnect();
      cancel.click();
    });
    observe.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
  await page
    .locator('input[type="file"]')
    .setInputFiles(
      path.resolve("tests/fixtures/review/usda-fresh-produce.jpg"),
    );
  await expect(page.getByText("Conversion cancelled.")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "Download SVG" })).toBeHidden();
  await page.getByRole("button", { name: "Upload New Image" }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.resolve("tests/fixtures/formats/artwork.jpg"));
  expect(await renderedPreview(page)).toContain("<path");
});
