import { defineConfig } from "@playwright/test";

/** Native audio bridge tests need no website server or database. */
export default defineConfig({
	testDir: "./tests",
	testMatch: "e2e/929/sefer-view/app-recitation-decoder.test.ts",
	workers: 1,
	timeout: 60_000,
	use: { baseURL: "http://127.0.0.1:3013" },
	projects: [
		{ name: "Chromium", use: { browserName: "chromium" } },
		// Run on macOS: Playwright's Windows WebKit port omits Web Audio.
		{ name: "WebKit", use: { browserName: "webkit" } },
	],
	reporter: "list",
});
