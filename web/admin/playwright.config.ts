import { defineConfig, devices } from "@playwright/test";

// Use launcher script that handles DB and S3 population then starts the server
const webServerCommand = "node --import tsx ./tests/util/launch-e2e-server.mts";

export default defineConfig({
	testDir: "./tests/e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: [["html", { outputFolder: ".playwright-report" }]],
	outputDir: ".playwright-results",
	use: {
		baseURL: "http://localhost:3002",
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
		url: "http://localhost:3002",
		reuseExistingServer: !process.env.CI,
		timeout: 300000, // 5 minutes for CI to handle Rust compilation
	},
});
