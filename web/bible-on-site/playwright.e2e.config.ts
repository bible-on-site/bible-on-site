import { defineConfig } from "@playwright/test";
import { getBaseConfig } from "./playwright.base.config";
import { TestType } from "./test-type.ts";
export default defineConfig({
  ...getBaseConfig(TestType.E2E),
  fullyParallel: true,
  retries: 0,
});
