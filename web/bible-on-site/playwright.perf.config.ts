import { defineConfig } from "@playwright/test";
import { getBaseConfig } from "./playwright.base.config";
import { TestType } from "./test-type.ts";
export default defineConfig({
  ...getBaseConfig(TestType.PERF),
  fullyParallel: false,
  retries: process.env.CI ? 4 : 0,
  workers: 1,
});
