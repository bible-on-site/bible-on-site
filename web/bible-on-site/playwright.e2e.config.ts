import { defineConfig } from "@playwright/test";
import { getBaseConfig } from "./playwright.base.config";
import { TestType } from "./test-type";
export default defineConfig({
  ...getBaseConfig(TestType.E2E),
  fullyParallel: true,
  retries: 0,
  workers: process.env.CI ? "100%" : "50%",
});
