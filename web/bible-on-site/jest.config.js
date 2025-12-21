import nextJest from "next/jest.js";
import { isCI, shouldMeasureCov } from "../shared/tests-util/environment.mjs";
import { monocartAllFilter } from "./.covignore.mjs";

// TODO: transform into TS
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
		isCI ? ["github-actions", { silent: false }] : "default",
		...(isCI
			? [
					[
						"jest-junit",
						{ outputDirectory: ".jest-report", outputName: "unit-results.xml" },
					],
				]
			: []),
		...(shouldMeasureCov
			? [
					[
						"./tests/util/jest/coverage",
						{
							name: "Jest Monocart Coverage Report",
							all: {
								dir: ["./src"],
								filter: monocartAllFilter,
							},
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
		// ESM modules that need to be transformed: @hebcal, gematry, quick-lru
		"/node_modules/(?!(@hebcal|gematry|quick-lru)/)",
	];
	// Enable ESM module resolution for @hebcal/core and other ESM-only packages
	nextJestConfig.moduleNameMapper = {
		...nextJestConfig.moduleNameMapper,
		"^@hebcal/core$": "<rootDir>/node_modules/@hebcal/core/dist/esm/index.js",
	};

	return nextJestConfig;
}

export default nextJestConfigPromise;
