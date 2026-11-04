import { defineConfig } from "@playwright/test";
import { getBaseConfig } from "./playwright.base.config";
import {
	type TestConfigWebServer,
	TestType,
} from "./tests/util/playwright/types";

const baseConfig = getBaseConfig(TestType.PERF);

export default defineConfig({
	...baseConfig,
	globalSetup: "./playwright-perf-setup.mjs",
	globalTeardown: [
		"./playwright-perf-teardown.mjs",
		...(typeof baseConfig.globalTeardown === "string"
			? [baseConfig.globalTeardown]
			: baseConfig.globalTeardown || []),
	],
	webServer: {
		...(baseConfig.webServer as TestConfigWebServer),
		command: "bun run start",
	},
	fullyParallel: false,
	// Timing profiles require an idle browser host, including across projects.
	workers: 1,
	retries: process.env.CI ? 4 : 0,
});
