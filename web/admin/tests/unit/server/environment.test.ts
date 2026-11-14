import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start/server-only", () => ({}));

import {
	measureCovEnabled,
	productionRuntime,
	skipAuthEnabled,
} from "~/server/environment.server";

// #3069: SKIP_AUTH and MEASURE_COV are explicit local dev/test tools.
// In production the flags must fail closed even if accidentally set.
describe("local dev/test flag gating", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it.each(["development", "test", "staging", ""])(
		"treats NODE_ENV=%j as a non-production runtime",
		(nodeEnv) => {
			vi.stubEnv("NODE_ENV", nodeEnv);
			expect(productionRuntime()).toBe(false);
		},
	);

	it("treats NODE_ENV=production as the production runtime", () => {
		vi.stubEnv("NODE_ENV", "production");
		expect(productionRuntime()).toBe(true);
	});

	it("honors SKIP_AUTH outside production", () => {
		vi.stubEnv("NODE_ENV", "development");
		vi.stubEnv("SKIP_AUTH", "true");
		expect(skipAuthEnabled()).toBe(true);
	});

	it("honors MEASURE_COV outside production", () => {
		vi.stubEnv("NODE_ENV", "development");
		vi.stubEnv("MEASURE_COV", "1");
		expect(measureCovEnabled()).toBe(true);
	});

	it.each(["false", "1", "yes"])(
		"does not enable the auth bypass for SKIP_AUTH=%j",
		(value) => {
			vi.stubEnv("NODE_ENV", "development");
			vi.stubEnv("SKIP_AUTH", value);
			expect(skipAuthEnabled()).toBe(false);
		},
	);

	it.each(["production", "development"])(
		"fails closed in NODE_ENV=%s whenever SKIP_AUTH is unset",
		(nodeEnv) => {
			vi.stubEnv("NODE_ENV", nodeEnv);
			vi.stubEnv("SKIP_AUTH", "");
			expect(skipAuthEnabled()).toBe(false);
		},
	);

	it("ignores SKIP_AUTH in production even when set to true", () => {
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("SKIP_AUTH", "true");
		expect(skipAuthEnabled()).toBe(false);
	});

	it("ignores MEASURE_COV in production even when set to 1", () => {
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("MEASURE_COV", "1");
		expect(measureCovEnabled()).toBe(false);
	});

	it("does not enable the coverage drain for non-'1' values", () => {
		vi.stubEnv("NODE_ENV", "development");
		vi.stubEnv("MEASURE_COV", "true");
		expect(measureCovEnabled()).toBe(false);
	});
});
