/**
 * For a detailed explanation regarding each configuration property, visit:
 * https://jestjs.io/docs/configuration
 */

import nextJest from "next/jest.js";
const createJestConfig = nextJest({
	// path to Next.js app to load next.config.js and .env files into test environment
	dir: "./",
});
const reports = ["raw", "text"];
if (!process.env.CI) {
	reports.push("html");
}

/** @type {import('jest').Config} */
const config = {
	clearMocks: true,

	collectCoverage: true,
	coverageReporters: ["none"],
	collectCoverageFrom: ["./src/**/*.{ts,tsx,css,scss,js,json}"],
	setupFiles: ["./jest.setup.js"],
	preset: "ts-jest",
	reporters: [
		"default",
		[
			"./tests/util/jest/coverage",
			{
				name: "Jest Monocart Coverage Report",
				all: "./src",
				outputDir: "./coverage/unit",
				reports: reports,
			},
		],
	],
	testEnvironment: "jsdom",
	testMatch: ["**/tests/(unit|integration)/**/*.test.ts"],
	transform: {
		"^.+\\.ts$": "ts-jest",
	},
	transformIgnorePatterns: [
		// This will be overwritten in hackJestConfig.
	],
	extensionsToTreatAsEsm: [".ts", ".json"],
};

// work around https://github.com/vercel/next.js/issues/35634
async function hackJestConfig() {
	// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
	const nextJestConfig = await createJestConfig(config)();
	// modules within @hebcal and gematry to not be transformed.
	nextJestConfig.transformIgnorePatterns[0] =
		"/node_modules/(?!(@hebcal|gematry)/)";

	return nextJestConfig;
}

export default hackJestConfig;
