import nextJest from "next/jest.js";
import { isCI, shouldMeasureCov } from "../shared/tests-util/environment.mjs";
import { covIgnoreList, monocartAllFilter } from "./.covignore.mjs";

// SWC configuration with coverage instrumentation plugin
// Uses the same plugin as Next.js to ensure consistent branch line mappings
const swcCoverageConfig = [
	"@swc/jest",
	{
		jsc: {
			parser: {
				syntax: "typescript",
				tsx: true,
			},
			transform: {
				react: {
					runtime: "automatic",
				},
			},
			experimental: {
				plugins: [
					[
						"swc-plugin-coverage-instrument",
						{ unstableExclude: covIgnoreList },
					],
				],
			},
		},
	},
];

// TODO: transform into TS
/** @type {import('jest').Config} */
const config = {
	clearMocks: true,

	// When using SWC coverage instrumentation, we don't use Jest's built-in coverage
	// The coverage is collected via the SWC plugin and processed by our custom reporter
	collectCoverage: false,
	setupFiles: ["./jest.setup.js"],
	// Use setupFilesAfterEnv to collect coverage after tests complete
	setupFilesAfterEnv: shouldMeasureCov ? ["./jest.coverage-setup.js"] : [],
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
	// Use SWC with coverage plugin when measuring coverage, otherwise use ts-jest
	transform: shouldMeasureCov
		? { "^.+\\.(t|j)sx?$": swcCoverageConfig }
		: { "^.+\\.ts$": "ts-jest" },
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
		// ESM modules that need to be transformed: gematry, temporal-polyfill, sunrise-sunset-js
		"/node_modules/(?!(gematry|temporal-polyfill|sunrise-sunset-js)/)",
	];

	return nextJestConfig;
}

export default nextJestConfigPromise;
