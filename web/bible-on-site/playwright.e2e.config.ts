import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.base.config";
const TEST_TYPE = "e2e";
export default defineConfig({
  ...baseConfig,
  testMatch: [`${TEST_TYPE}/**/*.test.ts`],
  fullyParallel: true,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: `playwright-report/${TEST_TYPE}` }],
  ],
});
