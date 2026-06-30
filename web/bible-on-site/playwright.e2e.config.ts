import { defineConfig } from "@playwright/test";
import { isCI, shouldMeasureCov } from "../shared/tests-util/environment.mjs";
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
	// Browser-timing nondeterminism under parallel CI load (e.g. the lazy
	// FlipBook mount) can occasionally exceed a wait. Retry on CI so a single
	// transient flake doesn't fail the whole job; a genuine regression still
	// fails every attempt, and a trace is captured on first retry (base config).
	// Locally we keep 0 retries to surface flakes during development.
	retries: isCI ? 2 : 0,
	workers: 4,
});
