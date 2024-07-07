import { devices } from "@playwright/test";
import { defineConfig } from "@playwright/test";
import type { CoverageReportOptions } from "monocart-reporter";
import { getDebugPort } from "./get-debug-port";
import type { TestType } from "./test-type";
export function getBaseConfig(testType: TestType) {
	const coverageReportOptions: CoverageReportOptions = {
		name: "Next.js Istanbul Coverage Report",
		outputDir: `./coverage/${testType}`,
		reports: ["html"],
	};

	/**
	 * Read environment variables from file.
	 * https://github.com/motdotla/dotenv
	 */
	// require('dotenv').config();

	/**
	 * See https://playwright.dev/docs/test-configuration.
	 */
	const config = defineConfig({
		testMatch: [`${testType}/**/*.test.ts`],
		testDir: "./tests",
		/* Fail the build on CI if you accidentally left test.only in the source code. */
		forbidOnly: !!process.env.CI,
		use: {
			/* Base URL to use in actions like `await page.goto('/')`. */
			baseURL: "http://127.0.0.1:3000",

			/* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
			trace: "on-first-retry",
		},
		globalTeardown: "./playwright-global-teardown.js",
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
			command: `npm run ${process.env.CI ? "start" : "dev"}`,
			url: "http://127.0.0.1:3000",
			reuseExistingServer: true, // consider that for some tests, such as for admin pages, restart the server before running each test
		},
		reporter: [
			["list"],
			["html", { outputFolder: `playwright-report/${testType}` }],
			[
				"monocart-reporter",
				{
					coverage: coverageReportOptions,
				},
			],
		],
	});
	return config;
}
