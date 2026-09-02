import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/web",
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: process.env.CI ? 1 : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:3001",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "cross-env CI=1 npm run dev -- --host 127.0.0.1",
    url: "http://127.0.0.1:3001",
    reuseExistingServer: !process.env.CI,
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
