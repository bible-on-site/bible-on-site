import * as fs from "node:fs";
import {
	defineConfig,
	devices,
	type ReporterDescription,
} from "@playwright/test";
import type { CoverageReportOptions } from "monocart-reporter";
import { isCI, shouldMeasureCov } from "../shared/tests-util/environment.mjs";
import { getDebugPort } from "./get-debug-port";
import type { TestType } from "./test-type";
export function getBaseConfig(testType: TestType) {
	const WEB_SERVER_URL = "http://127.0.0.1:3001";
	const config = defineConfig({
		testMatch: [`${testType}/**/*.test.ts`],
		testDir: "./tests",
		/* Fail the build on CI if you accidentally left test.only in the source code. */
		forbidOnly: isCI,
		use: {
			/* Base URL to use in actions like `await page.goto('/')`. */
			baseURL: WEB_SERVER_URL,

			/* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
			trace: "on-first-retry",
			timezoneId: "Asia/Jerusalem",
		},
		// Increase the default timeout to 1 min in case of CI (slow servers).
		timeout: isCI ? 60000 : 30000,
		globalSetup: "./playwright-global-setup.js",
		globalTeardown: shouldMeasureCov
			? "./playwright-global-teardown-coverage.js"
			: undefined,
		name: testType,
		projects: [
			{
				name: "chromium",
				use: { ...devices["Desktop Chrome"] },
			},
			{
				name: "Mobile Chrome",
				use: { ...devices["Pixel 5"] },
			},
		],

		webServer: {
			env: { NODE_OPTIONS: `--inspect=${getDebugPort()}` },
			timeout: 20000,
			command: "npm run dev-webpack",
			url: WEB_SERVER_URL,
			reuseExistingServer: true, // consider that for some tests, such as for admin pages, restart the server before running each test
		},
		reporter: [
			[isCI ? "github" : "list"],
			[
				"html",
				{ outputFolder: `.playwright-report/${testType}`, open: "never" },
			],
			...(isCI
				? [
						[
							"junit",
							{
								outputFile: `.playwright-report/${testType}/junit/${testType}-results.xml`,
							},
						] as ReporterDescription,
					]
				: []),
			...(shouldMeasureCov ? [getMonocartReporter()] : []),
		],
	});
	return config;

	function getMonocartReporter(): ReporterDescription {
		const GMT2_Offset = 60 * 2;
		return [
			"monocart-reporter",
			{
				coverage: getCoverageReportOptions(),
				timezoneOffset: GMT2_Offset, // TODO: check if during daylight saving time this is correct, if not append 60 mins accordingly
			},
		] as ReporterDescription;
	}

	function getCoverageReportOptions(): CoverageReportOptions {
		return {
			name: "Next.js Istanbul Coverage Report",
			outputDir: `${__dirname}/.coverage/${testType}`,
			reports: ["lcovonly"],

			// biome-ignore lint/correctness/noUnusedFunctionParameters: have some wierd bug. keeping for isolation
			onEnd: async (coverage) => {
				// Fixes path formatting in LCOV files for Windows paths
				const lcovPath = `.coverage/${testType}/lcov.info`;
				const content = fs.readFileSync(lcovPath, "utf8");
				// TODO: support any drive letter, not just C:
				const fixedContent = content.replace(/SF:C\\/g, "SF:C:\\");
				fs.writeFileSync(lcovPath, fixedContent);
			},
		};
	}
}
