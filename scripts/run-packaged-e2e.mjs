import { _electron as electron, expect } from "@playwright/test";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const packageRoot = process.env.SVGX_PACKAGE_ROOT || "release";
const candidates =
  process.platform === "win32"
    ? [`${packageRoot}/win-unpacked/SVG-X.exe`]
    : process.platform === "darwin"
      ? [
          `${packageRoot}/mac-arm64/SVG-X.app/Contents/MacOS/SVG-X`,
          `${packageRoot}/mac/SVG-X.app/Contents/MacOS/SVG-X`,
        ]
      : [`${packageRoot}/linux-unpacked/svg-x`];
let executablePath;
for (const candidate of candidates) {
  try {
    await access(candidate);
    executablePath = path.resolve(candidate);
    break;
  } catch {
    // Try the next platform-specific builder output.
  }
}
if (!executablePath)
  throw new Error(`Packaged executable not found in: ${candidates.join(", ")}`);

const port = String(3900 + Math.floor(Math.random() * 500));
const userDataDir = await mkdtemp(path.join(os.tmpdir(), "svg-x-e2e-"));
const nativeBatch = async (window) => {
  const input = path.join(userDataDir, "batch-input");
  const output = path.join(userDataDir, "batch-output");
  await Promise.all([mkdir(input), mkdir(output)]);
  const names = [
    "art.png",
    "art!.png",
    ...Array.from({ length: 30 }, (_, index) => `artwork-${index}.png`),
  ];
  await Promise.all(
    names.map((name) =>
      copyFile(
        "tests/fixtures/review/color-bicycle.png",
        path.join(input, name),
      ),
    ),
  );
  const original =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
  await writeFile(path.join(output, "art.svg"), original);
  const batch = window.getByRole("dialog", {
    name: "Batch conversion",
    exact: true,
  });
  console.log(`Select the real input directory in the native picker: ${input}`);
  await batch
    .getByRole("button", { name: "Select Input Directory" })
    .evaluate((button) => button.click());
  await expect(batch.getByTitle(input, { exact: true })).toBeVisible({
    timeout: 180_000,
  });
  console.log(
    `Select the real output directory in the native picker: ${output}`,
  );
  await batch
    .getByRole("button", { name: "Select Output Directory" })
    .evaluate((button) => button.click());
  await expect(batch.getByTitle(output, { exact: true })).toBeVisible({
    timeout: 180_000,
  });
  const start = async (name) => {
    await batch.getByRole("button", { name }).click();
    await window
      .getByRole("dialog", { name: "Confirm batch conversion" })
      .getByRole("button", { name: "Continue" })
      .click();
  };
  await start("Start Batch Processing");
  await expect(batch.getByText("Done", { exact: true }).first()).toBeVisible({
    timeout: 60_000,
  });
  await batch.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    batch.getByRole("button", { name: "Resume Pending Files" }),
  ).toBeVisible({ timeout: 60_000 });
  const paused = await readdir(output);
  expect(paused.length).toBeGreaterThan(1);
  expect(paused.length).toBeLessThan(names.length + 1);
  expect(paused.every((name) => name.endsWith(".svg"))).toBe(true);
  const preserved = await Promise.all(
    paused.map(async (name) => [
      name,
      await readFile(path.join(output, name), "utf8"),
    ]),
  );
  await start("Resume Pending Files");
  await expect(batch.getByText(/Remaining:\s*0/)).toBeVisible({
    timeout: 60_000,
  });
  await expect(
    batch.getByRole("button", { name: "Start Batch Processing" }),
  ).toBeEnabled();
  const files = await readdir(output);
  expect(files).toHaveLength(names.length + 1);
  expect(files).toEqual(
    expect.arrayContaining(["art.svg", "art-1.svg", "art-2.svg"]),
  );
  expect(files.every((name) => name.endsWith(".svg"))).toBe(true);
  expect(await readFile(path.join(output, "art.svg"), "utf8")).toBe(original);
  for (const [name, saved] of preserved)
    expect(await readFile(path.join(output, name), "utf8")).toBe(saved);
  for (const name of files.filter((name) => name !== "art.svg"))
    expect(await readFile(path.join(output, name), "utf8")).toMatch(
      /<svg[\s\S]*<path/,
    );
  console.log(
    `Native batch passed: ${paused.length - 1} complete at cancellation, ${names.length} complete after resume; three colliding names verified.`,
  );
};
const launchArgs = [`--user-data-dir=${userDataDir}`];
if (process.platform === "linux") launchArgs.push("--no-sandbox");
const application = await electron.launch({
  executablePath,
  env: { ...process.env, SVGX_PORT: port, SVGX_LAN: "0" },
  args: launchArgs,
});
try {
  const window = await application.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  if ((await window.title()) !== "SVG-X - Image to SVG Converter")
    throw new Error(`Unexpected packaged title: ${await window.title()}`);
  const desktopVersion = await window.evaluate(() =>
    window.electronAPI?.getAppVersion?.(),
  );
  if (desktopVersion !== "1.4.0")
    throw new Error(
      `Packaged preload bridge was unavailable: ${String(desktopVersion)}`,
    );
  const healthResponse = await fetch(`http://127.0.0.1:${port}/api/health`);
  const requiredHeaders = [
    "content-security-policy",
    "cross-origin-opener-policy",
    "cross-origin-resource-policy",
    "permissions-policy",
    "referrer-policy",
    "x-content-type-options",
  ];
  for (const header of requiredHeaders)
    if (!healthResponse.headers.get(header))
      throw new Error(`Packaged server omitted security header: ${header}`);
  const health = await healthResponse.json();
  if (health.ok !== true || health.lanEnabled !== false)
    throw new Error(
      `Invalid packaged health response: ${JSON.stringify(health)}`,
    );
  const networkInfo = await fetch(
    `http://127.0.0.1:${port}/api/network-info`,
  ).then((response) => response.json());
  if (networkInfo.lanEnabled !== false || networkInfo.networkUrls.length !== 0)
    throw new Error(
      `LAN was advertised without opt-in: ${JSON.stringify(networkInfo)}`,
    );

  const batchTrigger = window.getByRole("button", {
    name: "Open batch conversion",
  });
  await batchTrigger.focus();
  await batchTrigger.evaluate((button) => button.click());
  await window
    .getByRole("dialog", { name: "Batch conversion" })
    .waitFor({ state: "visible" });
  if (process.env.SVGX_NATIVE_BATCH === "1") await nativeBatch(window);
  await window.keyboard.press("Escape");
  await batchTrigger.waitFor({ state: "visible" });
  await window
    .locator('input[type="file"]')
    .setInputFiles(path.resolve("tests/fixtures/review/color-bicycle.png"));
  await window
    .getByText(/Conversion complete!|Conversion failed — see error above/)
    .waitFor({ timeout: 60_000 });
  if (
    await window
      .getByText("Conversion failed — see error above")
      .isVisible()
      .catch(() => false)
  ) {
    const errorText = await window.locator("body").innerText();
    throw new Error(`Packaged conversion failed:\n${errorText}`);
  }
  if ((await window.locator("svg path").count()) < 1)
    throw new Error("Packaged conversion produced no vector paths");
} finally {
  await application.close();
  await rm(userDataDir, { recursive: true, force: true });
}

console.log(`Packaged SVG-X smoke passed on ${process.platform}`);
