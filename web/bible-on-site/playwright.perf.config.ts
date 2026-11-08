import { defineConfig } from "@playwright/test";
import { getBaseConfig } from "./playwright.base.config";
import { webServerPort } from "./tests/util/playwright/server-endpoint";
import {
	type TestConfigWebServer,
	TestType,
} from "./tests/util/playwright/types";

const baseConfig = getBaseConfig(TestType.PERF);
// Same deterministic port getBaseConfig derived for this suite.
const port = webServerPort(TestType.PERF);

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
		// `bun run start` forces PORT=3001 through cross-env, so the standalone
		// server is invoked directly and receives the suite's port via env —
		// the same command the script wraps (issue #2881).
		command: "node .next/standalone/server.js",
		env: {
			...(baseConfig.webServer as TestConfigWebServer).env,
			PORT: String(port),
			HOSTNAME: "127.0.0.1",
			// Enables /api/dev/memory on the production server for the perf benchmark
			ENABLE_DEV_MEMORY_API: "1",
		},
	},
	fullyParallel: false,
	// Timing profiles require an idle browser host, including across projects.
	workers: 1,
	retries: process.env.CI ? 4 : 0,
});
