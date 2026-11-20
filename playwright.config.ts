import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000" },
  webServer: process.env.E2E_BASE_URL ? undefined : { command: "pnpm build && pnpm start", url: "http://localhost:3000", timeout: 300_000, reuseExistingServer: true },
  projects: [
    { name: "phone-320", use: { ...devices["Desktop Chrome"], viewport: { width: 320, height: 700 } } },
    { name: "phone-375", use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 } } },
    { name: "tablet-768", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } } },
    { name: "laptop-1024", use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 768 } } },
    { name: "desktop-1440", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
});
