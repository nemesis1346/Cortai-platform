import { defineConfig, devices } from "@playwright/test";

const host = process.env.PLAYWRIGHT_HOST || "localhost";
const port = Number(process.env.PORT || 3100);
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://${host}:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? "/tmp/cortai-playwright-results",
  timeout: 60_000,
  use: {
    baseURL,
    trace: "on-first-retry",
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
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
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          // executablePath inside launchOptions is the correct location.
          // On Ubuntu 26.04 set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to the
          // real binary (not the snap wrapper), e.g. the path discovered by:
          //   readlink -f /usr/bin/chromium-browser
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        },
      },
    }
  ]
});
