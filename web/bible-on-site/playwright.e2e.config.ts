import { defineConfig } from "@playwright/test";
import { shouldMeasureCov } from "../shared/tests-util/environment.mjs";
import { getBaseConfig } from "./playwright.base.config";
import {
	type TestConfigWebServer,
	TestType,
} from "./tests/util/playwright/types";

const baseConfig = getBaseConfig(TestType.E2E);

// Use dev-webpack when measuring coverage (needs instrumentation), otherwise use production server for stability
const webServerCommand = shouldMeasureCov
	? "npm run dev"
	: "npm run start";

export default defineConfig({
	...baseConfig,
	webServer: {
		...(baseConfig.webServer as TestConfigWebServer),
		command: webServerCommand,
	},
	fullyParallel: true,
	retries: 0,
	workers: process.env.CI ? "100%" : "50%",
});
