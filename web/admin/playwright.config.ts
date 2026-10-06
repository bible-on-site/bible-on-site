import * as fs from "node:fs";
import {
	defineConfig,
	devices,
	type ReporterDescription,
} from "@playwright/test";
import type { CoverageReportOptions } from "monocart-reporter";
import { shouldMeasureCov } from "../shared/tests-util/environment.mjs";

// Use launcher script that handles DB and S3 population then starts the server
const webServerCommand = "node --import tsx ./tests/util/launch-e2e-server.mts";

export default defineConfig({
	testDir: "./tests/e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: [
		["html", { outputFolder: ".playwright-report" }],
		...(shouldMeasureCov ? [getMonocartReporter()] : []),
	],
	outputDir: ".playwright-results",
	globalTeardown: shouldMeasureCov
		? "./tests/util/e2e-server-coverage-teardown.ts"
		: undefined,
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
		// Keep only this app's own modules: client code arrives as
		// http://localhost:3101/src/... URLs, Nitro SSR modules as file: URLs.
		entryFilter: (entry) => {
			const url = (entry.url ?? "").replace(/\\/g, "/");
			if (url.includes("node_modules") || url.includes("/.vite/")) {
				return false;
			}
			return /\.(?:m?[jt]sx?)(\?|#|$)/.test(url);
		},
		sourceFilter: (sourcePath) => {
			const normalized = sourcePath.replace(/\\/g, "/");
			return (
				normalized.includes("/src/") && !normalized.includes("node_modules")
			);
		},
		// Files never loaded during e2e still count as uncovered.
		all: {
			dir: ["./src"],
			filter: {
				"**/*.css": false,
				"**/routeTree.gen.ts": false,
				"**/*": true,
			},
		},
		onEnd: async () => {
			// Prefix SF paths so Codecov maps them to web/admin/, and fix the
			// Windows drive-letter formatting quirk (same fix as the website).
			const lcovPath = ".coverage/e2e/lcov.info";
			const content = fs.readFileSync(lcovPath, "utf8");
			const fixed = content
				.replace(/SF:C\\/g, "SF:C:\\")
				.replace(/^SF:src\//gm, "SF:web/admin/src/")
				.replace(/^SF:src\\/gm, "SF:web/admin/src/");
			fs.writeFileSync(lcovPath, fixed);
		},
	};
}
