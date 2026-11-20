import { _electron as electron, chromium, expect } from "@playwright/test";
import { execFile } from "node:child_process";
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
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const execute = promisify(execFile);
const chooseDirectory = async (directory, title) => {
  if (process.env.SVGX_GTK_PICKER !== "1") {
    console.log(`Select the real directory in the native picker: ${directory}`);
    return;
  }
  const run = (...args) => execute("xdotool", args, { timeout: 20_000 });
  const { stdout } = await run(
    "search",
    "--sync",
    "--onlyvisible",
    "--name",
    `^${title}$`,
  );
  const dialog = stdout.trim().split(/\s+/)[0];
  await run("windowfocus", "--sync", dialog, "key", "ctrl+l");
  await delay(200);
  await run("key", "ctrl+a");
  await run("type", "--clearmodifiers", "--delay", "10", `${directory}/`);
  // Open commits the folder typed into GTK's location field.
  await run("key", "--clearmodifiers", "alt+o");
};

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
const lanEnabled = process.env.SVGX_TEST_LAN === "1";
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
  const formats = ["avif", "bmp", "gif", "jpg", "tiff", "webp"];
  for (const format of formats) names.push(`mixed.${format}`);
  await Promise.all(
    names.map((name) =>
      copyFile(
        name.startsWith("mixed.")
          ? `tests/fixtures/formats/artwork${path.extname(name)}`
          : "tests/fixtures/review/color-bicycle.png",
        path.join(input, name),
      ),
    ),
  );
  const brokenName = "000-broken.png";
  const brokenPath = path.join(input, brokenName);
  await writeFile(brokenPath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const original =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
  await writeFile(path.join(output, "art.svg"), original);
  const batch = window.getByRole("dialog", {
    name: "Batch conversion",
    exact: true,
  });
  await batch
    .getByRole("button", { name: "Select Input Directory" })
    .evaluate((button) => button.click());
  await chooseDirectory(input, "Select Input Directory Containing Images");
  const pickerTimeout = process.env.SVGX_GTK_PICKER === "1" ? 20_000 : 180_000;
  await expect(batch.getByTitle(input, { exact: true })).toBeVisible({
    timeout: pickerTimeout,
  });
  await batch
    .getByRole("button", { name: "Select Output Directory" })
    .evaluate((button) => button.click());
  await chooseDirectory(output, "Select Output Directory");
  await expect(batch.getByTitle(output, { exact: true })).toBeVisible({
    timeout: pickerTimeout,
  });
  const start = async (name) => {
    await batch.getByRole("button", { name }).click();
    await window
      .getByRole("dialog", { name: "Confirm batch conversion" })
      .getByRole("button", { name: "Continue" })
      .click();
  };
  const started = performance.now();
  await start("Start Batch Processing");
  await expect(batch.getByText("Done", { exact: true }).first()).toBeVisible({
    timeout: 60_000,
  });
  const cancelling = performance.now();
  await batch.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    batch.getByRole("button", { name: "Resume Pending Files" }),
  ).toBeVisible({ timeout: 60_000 });
  const cancelMs = performance.now() - cancelling;
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
  const queueMs = performance.now() - started;
  const files = await readdir(output);
  expect(files).toHaveLength(names.length + 1);
  expect(files).toEqual(
    expect.arrayContaining(["art.svg", "art-1.svg", "art-2.svg"]),
  );
  expect(files.every((name) => name.endsWith(".svg"))).toBe(true);
  expect(files).not.toContain("000-broken.svg");
  expect(await readFile(path.join(output, "art.svg"), "utf8")).toBe(original);
  for (const [name, saved] of preserved)
    expect(await readFile(path.join(output, name), "utf8")).toBe(saved);
  for (const name of files.filter((name) => name !== "art.svg"))
    expect(await readFile(path.join(output, name), "utf8")).toMatch(
      /<svg[\s\S]*<path/,
    );
  const completed = await Promise.all(
    files.map(async (name) => [
      name,
      await readFile(path.join(output, name), "utf8"),
    ]),
  );
  const retry = batch.getByRole("button", {
    name: "Retry Failed (1)",
    exact: true,
  });
  await expect(retry).toBeVisible();
  await copyFile("tests/fixtures/review/color-bicycle.png", brokenPath);
  const retryStarted = performance.now();
  await retry.click();
  await expect(
    batch.getByRole("button", { name: "Start Batch Processing" }),
  ).toBeEnabled({ timeout: 60_000 });
  const retryMs = performance.now() - retryStarted;
  expect(await readFile(path.join(output, "000-broken.svg"), "utf8")).toMatch(
    /<svg[\s\S]*<path/,
  );
  expect(await readdir(output)).toHaveLength(names.length + 2);
  for (const [name, saved] of completed)
    expect(await readFile(path.join(output, name), "utf8")).toBe(saved);
  await expect(retry).toHaveCount(0);
  console.log(
    `Native batch passed: ${paused.length - 1} complete at cancellation, ${names.length} after resume, one repaired retry; queue ${queueMs.toFixed(0)} ms, cancel drain ${cancelMs.toFixed(0)} ms, retry ${retryMs.toFixed(0)} ms.`,
  );
};
const launchArgs = [`--user-data-dir=${userDataDir}`];
if (process.platform === "linux") launchArgs.push("--no-sandbox");
if (process.env.SVGX_GTK_PICKER === "1")
  launchArgs.push("--gtk-version=3", "--xdg-portal-required-version=999");
const application = await electron.launch({
  executablePath,
  env: { ...process.env, SVGX_PORT: port, SVGX_LAN: lanEnabled ? "1" : "0" },
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
  if (health.ok !== true || health.lanEnabled !== lanEnabled)
    throw new Error(
      `Invalid packaged health response: ${JSON.stringify(health)}`,
    );
  const networkInfo = await fetch(
    `http://127.0.0.1:${port}/api/network-info`,
  ).then((response) => response.json());
  if (
    networkInfo.lanEnabled !== lanEnabled ||
    (!lanEnabled && networkInfo.networkUrls.length !== 0)
  )
    throw new Error(
      `LAN was advertised without opt-in: ${JSON.stringify(networkInfo)}`,
    );
  if (lanEnabled) {
    const actualAddresses = new Set(
      Object.values(os.networkInterfaces()).flatMap((entries) =>
        (entries ?? [])
          .filter((entry) => !entry.internal)
          .map((entry) => entry.address),
      ),
    );
    let reachable;
    for (const url of networkInfo.networkUrls) {
      try {
        const origin = new URL(url);
        if (!actualAddresses.has(origin.hostname.replace(/^\[|\]$/g, "")))
          continue;
        const info = await fetch(new URL("/api/network-info", origin), {
          signal: AbortSignal.timeout(2500),
        });
        const home = await fetch(origin, { signal: AbortSignal.timeout(2500) });
        const asset = (await home.text()).match(
          /<script[^>]+src="([^"]+)"/,
        )?.[1];
        if (!info.ok || !(await info.json()).lanEnabled || !home.ok || !asset)
          continue;
        const js = await fetch(new URL(asset, origin), {
          signal: AbortSignal.timeout(2500),
        });
        if (!js.ok) continue;
        await js.arrayBuffer();
        reachable = origin.href;
        break;
      } catch {
        // Some advertised adapters, for example VPNs, can block local probes.
      }
    }
    if (!reachable)
      throw new Error(
        "LAN listener was unreachable through every advertised non-loopback address",
      );
    const browser = await chromium.launch();
    try {
      const exportFrom = async (url) => {
        const page = await browser.newPage();
        await page.goto(url);
        expect(await page.evaluate(() => Boolean(window.electronAPI))).toBe(
          false,
        );
        await page
          .locator('input[type="file"]')
          .setInputFiles(
            path.resolve("tests/fixtures/review/color-bicycle.png"),
          );
        await expect(page.getByText("Conversion complete!")).toBeVisible({
          timeout: 60_000,
        });
        const download = page.waitForEvent("download");
        await page.getByRole("button", { name: "Download SVG" }).click();
        return readFile(await (await download).path(), "utf8");
      };
      const loopback = await exportFrom(`http://127.0.0.1:${port}`);
      expect(loopback).toMatch(/<svg[\s\S]*<path/);
      expect(await exportFrom(reachable)).toBe(loopback);
    } finally {
      await browser.close();
    }
    console.log(
      "LAN and loopback browsers exported byte-identical SVG without desktop IPC",
    );
  }

  const batchTrigger = window.getByRole("button", {
    name: "Open batch conversion",
  });
  await batchTrigger.focus();
  await batchTrigger.evaluate((button) => button.click());
  await window
    .getByRole("dialog", { name: "Batch conversion" })
    .waitFor({ state: "visible" });
  if (process.env.SVGX_NATIVE_BATCH === "1") {
    let sampling = true;
    let peakWorkingSet = 0;
    let samples = 0;
    let sampleError;
    const sampleMemory = async () => {
      while (sampling) {
        try {
          const workingSet = await application.evaluate(({ app }) =>
            app
              .getAppMetrics()
              .reduce((total, { memory }) => total + memory.workingSetSize, 0),
          );
          peakWorkingSet = Math.max(peakWorkingSet, workingSet);
          samples += 1;
        } catch (error) {
          sampleError = error;
          break;
        }
        await delay(250);
      }
    };
    const measurements = sampleMemory();
    try {
      await nativeBatch(window);
    } catch (error) {
      console.error(
        await window
          .getByRole("dialog", { name: "Batch conversion" })
          .innerText({ timeout: 2000 })
          .catch(() => ""),
      );
      throw error;
    } finally {
      sampling = false;
      await measurements;
    }
    if (sampleError) throw sampleError;
    expect(peakWorkingSet).toBeGreaterThan(0);
    console.log(
      `Native batch peak sampled aggregate working set: ${(peakWorkingSet / 1024).toFixed(1)} MiB (${samples} samples).`,
    );
  }
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
