import { devices } from "@playwright/test";
import { defineConfig } from "@playwright/test";
import type { CoverageReportOptions } from "monocart-reporter";
import { getDebugPort } from "./get-debug-port";
import type { TestType } from "./test-type";

export function getBaseConfig(testType: TestType) {
  const reports = ["raw", "text"];
  if (!process.env.CI) {
    reports.push("html");
  }

  const coverageReportOptions: CoverageReportOptions = {
    name: "Next.js Istanbul Coverage Report",
    outputDir: `./coverage/${testType}`,
    reports: reports,
  };

  const WEB_SERVER_URL = "http://127.0.0.1:3000";
  const config = defineConfig({
    testMatch: [`${testType}/**/*.test.ts`],
    testDir: "./tests",
    /* Fail the build on CI if you accidentally left test.only in the source code. */
    forbidOnly: !!process.env.CI,
    use: {
      /* Base URL to use in actions like `await page.goto('/')`. */
      baseURL: WEB_SERVER_URL,

      /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
      trace: "on-first-retry",
    },
    globalTeardown: "./playwright-global-teardown.js",
    projects: [
      {
        name: "chromium",
        use: { ...devices["Desktop Chrome"] },
      },
      {
        name: "Mobile Chrome",
        use: { ...devices["Pixel 5"] },
      },
    ],

    webServer: {
      env: { NODE_OPTIONS: `--inspect=${getDebugPort()}` },
      timeout: 20000,
      command: "npm run dev",
      url: WEB_SERVER_URL,
      reuseExistingServer: true, // consider that for some tests, such as for admin pages, restart the server before running each test
    },
    reporter: [
      // results:
      ["list"],
      ["html", { outputFolder: `playwright-report/${testType}` }],
      // Coverage:
      [
        "monocart-reporter",
        {
          coverage: coverageReportOptions,
        },
      ],
    ],
  });
  return config;
}
