import { defineConfig, devices } from "@playwright/test";

const benchmarkPreview = process.env.SVGX_PREVIEW_BENCHMARK === "1";
const baseURL = benchmarkPreview
  ? "http://127.0.0.1:4173"
  : "http://127.0.0.1:3001";

export default defineConfig({
  testDir: "./e2e/web",
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: process.env.CI ? 1 : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: benchmarkPreview
      ? "npm run preview -- --host 127.0.0.1 --port 4173 --strictPort"
      : "cross-env CI=1 npm run dev -- --host 127.0.0.1",
    url: baseURL,
    reuseExistingServer: !benchmarkPreview && !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { args: ["--enable-precise-memory-info"] },
      },
    },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
