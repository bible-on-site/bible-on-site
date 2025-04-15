/**
 * For a detailed explanation regarding each configuration property, visit:
 * https://jestjs.io/docs/configuration
 */

import nextJest from "next/jest.js";
const createJestConfig = nextJest({
	// path to Next.js app to load next.config.js and .env files into test environment
	dir: "./",
});

const measureCov = flagToBool(process.env.MEASURE_COV, true);
/** @type {import('jest').Config} */
const config = {
	clearMocks: true,

	collectCoverage: measureCov,
	coverageReporters: ["none"],
	collectCoverageFrom: ["./src/**/*.{ts,tsx,css,scss,js,json}"],
	setupFiles: ["./jest.setup.js"],
	preset: "ts-jest",
	reporters: getReporters(),
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

function getReporters() {
	const result = ["default"];

	if (measureCov) {
		result.push([
			"./tests/util/jest/coverage",
			{
				name: "Jest Monocart Coverage Report",
				all: "./src",
				outputDir: "./coverage/unit",
				reports: ["lcovonly"],
			},
		]);
	}
	return result;
}
function flagToBool(value, defaultValue) {
	if (value === undefined || value === null || value === "") {
		return defaultValue;
	}
	return value === 1 || value === "1";
}

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
