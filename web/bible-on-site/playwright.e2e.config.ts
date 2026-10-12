import { defineConfig } from "@playwright/test";
import { isCI, shouldMeasureCov } from "../shared/tests-util/environment.mjs";
import { getBaseConfig } from "./playwright.base.config";
import {
	type TestConfigWebServer,
	TestType,
} from "./tests/util/playwright/types";

const baseConfig = getBaseConfig(TestType.E2E);

// Use launcher script that handles DB population then starts the server
// Uses next dev in both modes; production behavior is checked by the performance suite.
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
	// Coverage mode ran fully serialized (workers: 1) since #1784 for caution;
	// coverage is captured per-test via CDP, so workers do not share collection
	// state. Two workers halves the ~12min suite on the 4-vCPU runner; the
	// cross-module coverage gate loudly catches any collection break.
	workers: shouldMeasureCov ? 2 : 4,
});
