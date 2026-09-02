import { _electron as electron } from "playwright";
import { access } from "node:fs/promises";
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
const application = await electron.launch({
  executablePath,
  env: { ...process.env, SVGX_PORT: port, SVGX_LAN: "0" },
});
try {
  const window = await application.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  if ((await window.title()) !== "SVG-X - Image to SVG Converter")
    throw new Error(`Unexpected packaged title: ${await window.title()}`);
  const health = await fetch(`http://127.0.0.1:${port}/api/health`).then(
    (response) => response.json(),
  );
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
  await batchTrigger.click();
  await window
    .getByRole("dialog", { name: "Batch conversion" })
    .waitFor({ state: "visible" });
  await window.keyboard.press("Escape");
  await batchTrigger.waitFor({ state: "visible" });
  if (
    !(await batchTrigger.evaluate(
      (element) => document.activeElement === element,
    ))
  )
    throw new Error("Batch dialog did not restore focus to its trigger");
  await window
    .locator('input[type="file"]')
    .setInputFiles(path.resolve("tests/fixtures/review/color-bicycle.png"));
  await window.getByText("Conversion complete!").waitFor({ timeout: 60_000 });
  if ((await window.locator("svg path").count()) < 1)
    throw new Error("Packaged conversion produced no vector paths");
} finally {
  await application.close();
}

console.log(`Packaged SVG-X smoke passed on ${process.platform}`);
