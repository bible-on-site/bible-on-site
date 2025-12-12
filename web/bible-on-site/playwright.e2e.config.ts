import { defineConfig } from "@playwright/test";
import { getBaseConfig } from "./playwright.base.config";
import {
	type TestConfigWebServer,
	TestType,
} from "./tests/util/playwright/types";

const baseConfig = getBaseConfig(TestType.E2E);
export default defineConfig({
	...baseConfig,
	webServer: {
		...(baseConfig.webServer as TestConfigWebServer),
		command: "npm run dev",
	},
	fullyParallel: true,
	retries: 0,
	workers: process.env.CI ? "100%" : "50%",
});
