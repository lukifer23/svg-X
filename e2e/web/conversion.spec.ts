import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import path from "node:path";

const fixture = path.resolve("tests/fixtures/review/color-bicycle.png");

test("uploads, converts, changes mode, and exports real geometry", async ({
  page,
}) => {
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Drop zone/ }).click();
  await (await chooser).setFiles(fixture);
  await expect(page.getByText("Conversion complete!")).toBeVisible();
  await expect(page.locator("svg path").first()).toBeVisible();

  await page.getByRole("button", { name: "Open settings panel" }).click();
  await page.getByRole("radio", { name: /Color/ }).click();
  await page.getByRole("button", { name: "Apply current settings" }).click();
  await expect(page.getByText("Conversion complete!")).toBeVisible();
  await expect(
    page.locator('svg path[fill-rule="evenodd"]').first(),
  ).toBeVisible();

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
  expect((await svgDownload).suggestedFilename()).toMatch(/\.svg$/);

  await page.getByRole("button", { name: "More export formats" }).click();
  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: /JSON/ }).click();
  expect((await jsonDownload).suggestedFilename()).toMatch(/\.json$/);
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
  await expect(page.locator("svg path").first()).toBeVisible();
});
