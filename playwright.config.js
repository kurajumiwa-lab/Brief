import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: ["requests.spec.js", "supply.spec.js", "matching.spec.js", "quotes.spec.js", "workOrders.spec.js", "brand-launch.spec.js", "order-tracking.spec.js", "product-reviews.spec.js", "business-feed.spec.js"],
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:8788",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.BRIEF_TEST_CHROMIUM
      ? {
          executablePath: process.env.BRIEF_TEST_CHROMIUM,
          args: ["--no-sandbox", "--no-zygote", "--disable-dev-shm-usage"],
        }
      : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], viewport: { width: 360, height: 800 } },
    },
  ],
  webServer: {
    command: "node scripts/request-test-server.mjs",
    url: "http://127.0.0.1:8788/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
