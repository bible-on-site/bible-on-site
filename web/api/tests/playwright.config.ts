import {
	defineConfig,
	devices,
	type ReporterDescription,
} from "@playwright/test";
import {
	isCI,
	isCopilot,
	shouldMeasureCov,
} from "../../shared/tests-util/environment.mjs";

const WEB_SERVER_URL = "http://127.0.0.1:3003";
const isNonInteractive = isCI || isCopilot;
export default defineConfig({
	testMatch: ["**/*.test.ts"],
	testDir: "./e2e",
	/* Fail the build on CI if you accidentally left test.only in the source code. */
	forbidOnly: isNonInteractive,
	use: {
		/* Base URL to use in actions like `await page.goto('/')`. */
		baseURL: WEB_SERVER_URL,

		/* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
		trace: "on-first-retry",
		timezoneId: "Asia/Jerusalem",
	},
	// Increase the default timeout to 1 min in case of CI (slow servers).
	timeout: isNonInteractive ? 60000 : 30000,
	globalSetup: "./playwright-global-setup.mts",
	globalTeardown: "./playwright-global-teardown.mjs",
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	fullyParallel: true,
	retries: 0,
	workers: isNonInteractive ? "100%" : "50%",

	reporter: [
		["list"],
		// [
		// 	"html",
		// 	{
		// 		outputFolder: "../.playwright-report/e2e/html",
		// 		open: isNonInteractive ? "never" : "on-failure",
		// 	},
		// ],
		...(isNonInteractive
			? [
					[
						"junit",
						{
							outputFile: "../.playwright-report/e2e/junit/results.xml",
						},
					] as ReporterDescription,
				]
			: []),
	],

	webServer: {
		// Wait until WEB_SERVER_URL returns a successful response
		command: `node --import tsx ./launch-api-for-tests.mts ${shouldMeasureCov ? "--measure-cov" : ""}`,
		timeout: 240000,
		url: WEB_SERVER_URL,
		reuseExistingServer: true, // consider that for some tests, such as for admin pages, restart the server before running each test
	},
});
