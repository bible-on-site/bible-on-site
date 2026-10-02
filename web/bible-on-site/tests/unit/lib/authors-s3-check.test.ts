/**
 * Tests for checkS3Availability happy path (via getAuthorImageUrl).
 * Isolated in a separate file to get a fresh module with s3WarningShown = false.
 * Mocks global.fetch to simulate a successful S3 health check.
 */

// Mock api-client so no real DB is used
jest.mock("../../../src/lib/api-client", () => ({
	query: jest.fn(),
}));

import { getAuthorImageUrl } from "../../../src/lib/authors/service";

describe("checkS3Availability happy path", () => {
	const originalEnv = process.env;
	const originalFetch = global.fetch;

	beforeEach(() => {
		process.env = { ...originalEnv };
		jest.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		jest.restoreAllMocks();
		global.fetch = originalFetch;
		process.env = originalEnv;
	});

	it("completes without warning when S3 is reachable", async () => {
		process.env.S3_ENDPOINT = "http://localhost:4566";
		jest.replaceProperty(process.env, "NODE_ENV", "test");

		const mockFetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
		global.fetch = mockFetch;

		// getAuthorImageUrl fires checkS3Availability (fire-and-forget)
		getAuthorImageUrl(1);

		// Wait for the async checkS3Availability to complete
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(mockFetch).toHaveBeenCalledWith(
			"http://localhost:4566/health/ready",
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);

		// No warning should have been shown — S3 is available
		expect(console.warn).not.toHaveBeenCalled();
	});

	it("does not check when S3_ENDPOINT is not set", async () => {
		delete process.env.S3_ENDPOINT;

		const mockFetch = jest.fn();
		global.fetch = mockFetch;

		getAuthorImageUrl(1);

		await new Promise((resolve) => setTimeout(resolve, 50));

		// fetch should not be called — checkS3Availability returns early
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("aborts a stalled health check after one second and warns only once", async () => {
		jest.useFakeTimers();
		process.env.S3_ENDPOINT = "http://localhost:9000";
		jest.replaceProperty(process.env, "NODE_ENV", "development");
		global.fetch = jest.fn(
			(_url, options) =>
				new Promise((_resolve, reject) => {
					options?.signal?.addEventListener("abort", () =>
						reject(new Error("aborted")),
					);
				}),
		);
		try {
			getAuthorImageUrl(1);
			await jest.advanceTimersByTimeAsync(999);
			expect(console.warn).not.toHaveBeenCalled();
			await jest.advanceTimersByTimeAsync(1);
			expect(console.warn).toHaveBeenCalledTimes(1);
			getAuthorImageUrl(2);
			expect(global.fetch).toHaveBeenCalledTimes(1);
		} finally {
			jest.useRealTimers();
		}
	});

	it("warns once about an unhealthy S3 response and still supplies image URLs", async () => {
		process.env.S3_ENDPOINT = "http://localhost:9000";
		jest.replaceProperty(process.env, "NODE_ENV", "development");
		global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
		let freshImageUrl = getAuthorImageUrl;
		jest.isolateModules(() => {
			freshImageUrl =
				require("../../../src/lib/authors/service").getAuthorImageUrl;
		});
		expect(freshImageUrl(5)).toContain("5");
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(console.warn).toHaveBeenCalledTimes(1);
		freshImageUrl(6);
		expect(global.fetch).toHaveBeenCalledTimes(1);
	});
});
