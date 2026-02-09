import { defineConfig } from "@playwright/test";
import { shouldMeasureCov } from "../shared/tests-util/environment.mjs";
import { getBaseConfig } from "./playwright.base.config";
import {
	type TestConfigWebServer,
	TestType,
} from "./tests/util/playwright/types";

const baseConfig = getBaseConfig(TestType.E2E);

// Use launcher script that handles DB population then starts the server
// Uses dev server when measuring coverage (needs instrumentation), otherwise production server
const webServerCommand = `node --import tsx ./launch-e2e-server.mts ${shouldMeasureCov ? "--coverage" : ""}`;

export default defineConfig({
	...baseConfig,
	webServer: {
		...(baseConfig.webServer as TestConfigWebServer),
		command: webServerCommand,
	},
	fullyParallel: true,
	retries: 0,
	workers: 4,
});
