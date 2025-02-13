import { devices } from "@playwright/test";
import { defineConfig } from "@playwright/test";

const WEB_SERVER_URL = "http://127.0.0.1:3003/api/graphql";
export default defineConfig({
	testMatch: ["**/*.test.ts"],
	testDir: "./e2e",
	/* Fail the build on CI if you accidentally left test.only in the source code. */
	forbidOnly: !!process.env.CI,
	use: {
		/* Base URL to use in actions like `await page.goto('/')`. */
		baseURL: WEB_SERVER_URL,

		/* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
		trace: "on-first-retry",
		timezoneId: "Asia/Jerusalem",
	},
	// Increase the default timeout to 1 min in case of CI (slow servers).
	timeout: process.env.CI ? 60000 : 30000,
	globalTeardown: "./playwright-global-teardown.js",
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	fullyParallel: true,
	retries: 0,
	workers: process.env.CI ? "100%" : "50%",

	webServer: {
		// Wait until WEB_SERVER_URL returns a successful response
		command:
			"sh -c 'until curl --silent --fail --head \"$WEB_SERVER_URL\"; do sleep 1; done'",
		timeout: 90000,
		url: WEB_SERVER_URL,
		reuseExistingServer: true, // consider that for some tests, such as for admin pages, restart the server before running each test
	},
});
