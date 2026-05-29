import { defineConfig, devices } from "@playwright/test";

const host = process.env.PLAYWRIGHT_HOST || "localhost";
const port = Number(process.env.PORT || 3100);
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://${host}:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? "/tmp/cortai-playwright-results",
  use: {
    baseURL,
    trace: "on-first-retry"
  },
  webServer: {
    command: `NEXT_PUBLIC_API_BASE_URL= npm run dev -- --hostname ${host} --port ${port}`,
    url: `${baseURL}/en/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
