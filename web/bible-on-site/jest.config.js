import nextJest from "next/jest.js";
import { shouldMeasureCov } from "./tests/util/environment.mjs";

/** @type {import('jest').Config} */
const config = {
	clearMocks: true,

	collectCoverage: shouldMeasureCov,
	coverageReporters: ["none"],
	collectCoverageFrom: shouldMeasureCov
		? ["./src/**/*.{ts,tsx,css,scss,js,json}"]
		: undefined,
	setupFiles: ["./jest.setup.js"],
	preset: "ts-jest",
	reporters: [
		"default",
		...(shouldMeasureCov
			? [
					[
						"./tests/util/jest/coverage",
						{
							name: "Jest Monocart Coverage Report",
							all: "./src",
							outputDir: "./.coverage/unit",
							reports: ["lcovonly"],
						},
					],
				]
			: []),
	],
	testEnvironment: "jsdom",
	testMatch: ["**/tests/(unit|integration)/**/*.test.ts"],
	transform: {
		"^.+\\.ts$": "ts-jest",
	},
	extensionsToTreatAsEsm: [".ts", ".json"],
};

// work around https://github.com/vercel/next.js/issues/35634
async function nextJestConfigPromise() {
	const createNextJestConfig = nextJest({
		// path to Next.js app to load next.config.js and .env files into test environment
		dir: "./",
	});
	const nextJestConfig = await createNextJestConfig(config)();
	// This cannot be set directly in the jest config because it is overridden by next/jest.
	nextJestConfig.transformIgnorePatterns = [
		// modules within @hebcal and gematry to not be transformed.
		"/node_modules/(?!(@hebcal|gematry)/)",
	];

	return nextJestConfig;
}

export default nextJestConfigPromise;
