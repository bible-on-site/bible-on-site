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
			// Normalize SF paths to forward slashes and prefix with web/admin/ so
			// Codecov flag matching maps them to the admin module.
			const lcovPath = ".coverage/e2e/lcov.info";
			const content = fs.readFileSync(lcovPath, "utf8");
			const fixed = content.replace(/^SF:.+$/gm, (line) => {
				let p = line.slice(3).replace(/\\/g, "/");
				const srcIdx = p.indexOf("web/admin/src/");
				if (srcIdx !== -1) {
					p = p.slice(srcIdx);
				} else if (p.startsWith("src/")) {
					p = `web/admin/${p}`;
				}
				return `SF:${p}`;
			});
			fs.writeFileSync(lcovPath, fixed);
		},
	};
}
