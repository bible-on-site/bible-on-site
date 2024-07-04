import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.base.config";
const TEST_TYPE = "perf";
export default defineConfig({
  ...baseConfig,
  testMatch: [`${TEST_TYPE}/**/*.test.ts`],
  fullyParallel: false,
  retries: 5,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: `playwright-report/${TEST_TYPE}` }],
  ],
});
