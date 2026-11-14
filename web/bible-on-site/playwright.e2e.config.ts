import { join } from "node:path";
import { defineConfig, type ReporterDescription } from "@playwright/test";
import { generateVAPIDKeys } from "web-push";
import { isCI, shouldMeasureCov } from "../shared/tests-util/environment.mjs";
import { getBaseConfig } from "./playwright.base.config";
import {
	type TestConfigWebServer,
	TestType,
} from "./tests/util/playwright/types";

const baseConfig = getBaseConfig(TestType.E2E);

// Deterministic e2e-impact evidence (#2085): under coverage runs the shared
// reporter writes discovered/test-results JSON here and the browser fixture
// drops per-test istanbul dumps alongside it. Nothing is written otherwise.
const E2E_IMPACT_DIR = join(__dirname, ".coverage", "e2e-impact");
if (shouldMeasureCov) {
	process.env.E2E_IMPACT_DIR = E2E_IMPACT_DIR;
}

// Use launcher script that handles DB population then starts the server
// Uses next dev in both modes; production behavior is checked by the performance suite.
const webServerCommand = `node ./launch-e2e-server.mts ${shouldMeasureCov ? "--coverage" : ""}`;

// Web push is exercised end-to-end (#1096): the e2e deployment enables the
// feature with throwaway per-run keys so the real opt-in toggle and
// subscription routes run against the test database. Browser tests stub only
// the platform transport (PushManager/OS notifications) that headless test
// browsers lack; nothing here reaches a real push service.
const vapidKeys = generateVAPIDKeys();
const webPushEnv: Record<string, string> = {
	VAPID_PUBLIC_KEY: vapidKeys.publicKey,
	VAPID_PRIVATE_KEY: vapidKeys.privateKey,
	VAPID_SUBJECT: "mailto:web-push-e2e@localhost.invalid",
	PUSH_SEND_SECRET: `e2e-${vapidKeys.privateKey.slice(0, 16)}`,
};

export default defineConfig({
	...baseConfig,
	reporter: [
		...(baseConfig.reporter as ReporterDescription[]),
		...(shouldMeasureCov
			? [["../shared/tests-util/e2e-impact"] as ReporterDescription]
			: []),
	],
	webServer: {
		...(baseConfig.webServer as TestConfigWebServer),
		command: webServerCommand,
		env: webPushEnv,
	},
	fullyParallel: true,
	// Browser-timing nondeterminism under parallel CI load (e.g. the lazy
	// FlipBook mount) can occasionally exceed a wait. Retry on CI so a single
	// transient flake doesn't fail the whole job; a genuine regression still
	// fails every attempt, and a trace is captured on first retry (base config).
	// Locally we keep 0 retries to surface flakes during development.
	retries: isCI ? 2 : 0,
	// Coverage mode ran fully serialized (workers: 1) since #1784 for caution;
	// coverage is captured per-test via __coverage__ drains (browser + server),
	// so workers do not share collection state. Two workers halves the ~12min suite on the 4-vCPU runner; the
	// cross-module coverage gate loudly catches any collection break.
	workers: shouldMeasureCov ? 2 : 4,
});
