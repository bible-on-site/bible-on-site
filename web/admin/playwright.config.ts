import * as fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	defineConfig,
	devices,
	type ReporterDescription,
} from "@playwright/test";
import type { CoverageReportOptions } from "monocart-reporter";
import { shouldMeasureCov } from "../shared/tests-util/environment.mjs";
import { normalizeE2eLcov } from "./tests/util/lcov-normalize.mts";

// Use launcher script that handles DB and S3 population then starts the server
const webServerCommand = "node ./tests/util/launch-e2e-server.mts";

// Deterministic e2e-impact evidence (#2085): under coverage runs the shared
// reporter writes discovered/test-results JSON here and the test fixture
// drops per-test istanbul dumps alongside it. Nothing is written otherwise.
const E2E_IMPACT_DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	".coverage",
	"e2e-impact",
);
if (shouldMeasureCov) {
	process.env.E2E_IMPACT_DIR = E2E_IMPACT_DIR;
}

export default defineConfig({
	testDir: "./tests/e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: [
		["html", { outputFolder: ".playwright-report" }],
		...(shouldMeasureCov ? [getMonocartReporter()] : []),
		...(shouldMeasureCov
			? [["../shared/tests-util/e2e-impact"] as ReporterDescription]
			: []),
	],
	outputDir: ".playwright-results",
	use: {
		baseURL: "http://localhost:3101",
		trace: "on-first-retry",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: {
		command: webServerCommand,
		url: "http://localhost:3101",
		reuseExistingServer: !process.env.CI,
		timeout: 300000, // 5 minutes for CI to handle Rust compilation
	},
});

function getMonocartReporter(): ReporterDescription {
	return [
		"monocart-reporter",
		{
			coverage: getCoverageReportOptions(),
		},
	] as ReporterDescription;
}

function getCoverageReportOptions(): CoverageReportOptions {
	return {
		name: "Admin E2E Coverage Report",
		outputDir: ".coverage/e2e",
		reports: ["lcovonly"],
		sourceFilter: (sourcePath) => {
			const normalized = sourcePath.replace(/\\/g, "/");
			return (
				normalized.includes("/src/") && !normalized.includes("node_modules")
			);
		},
		onEnd: async () => {
			// Rewrite SF paths into the repo-relative layout and fold TanStack
			// split chunks onto their source file — see lcov-normalize.mts.
			const lcovPath = ".coverage/e2e/lcov.info";
			const content = fs.readFileSync(lcovPath, "utf8");
			fs.writeFileSync(lcovPath, normalizeE2eLcov(content));
		},
	};
}
