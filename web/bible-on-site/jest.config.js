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
        // logging: 'debug',
        name: "Jest Monocart Coverage Report",
        all: "./src",

        sourcePath: {
          "src/": "",
        },

        outputDir: "./coverage/unit",

        reports: reports,
      },
    ],
  ],
  // globalTeardown: "./tests/util/jest/globalTeardown.js",
  testEnvironment: "jsdom",
  testMatch: ["**/tests/(unit|integration)/**/*.test.ts"],
  // A map from regular expressions to paths to transformers
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  extensionsToTreatAsEsm: [".ts", ".json"],
};

// work around https://github.com/vercel/next.js/issues/35634
async function hackJestConfig() {
  // createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
  const nextJestConfig = await createJestConfig(config)();
  // /node_modules/ is the first pattern, so overwrite it with the correct version
  nextJestConfig.transformIgnorePatterns[0] =
    "/node_modules/(?!gematry).+\\.js$";

  return nextJestConfig;
}

export default hackJestConfig;
