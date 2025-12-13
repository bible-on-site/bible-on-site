import { defineConfig } from "@playwright/test";
import { getBaseConfig } from "./playwright.base.config";
import {
	type TestConfigWebServer,
	TestType,
} from "./tests/util/playwright/types";

const baseConfig = getBaseConfig(TestType.PERF);

export default defineConfig({
	...baseConfig,
	webServer: {
		...(baseConfig.webServer as TestConfigWebServer),
		command: "npm run start",
	},
	fullyParallel: false,
	retries: process.env.CI ? 4 : 0,
	workers: 1,
});
