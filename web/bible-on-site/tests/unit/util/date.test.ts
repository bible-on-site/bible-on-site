import { getCurrentDate } from "../../../src/util/date";

const clearMockDateCookie = () => {
	document.cookie =
		"mock-date=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
};

describe("getCurrentDate", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		jest.resetModules();
		process.env = { ...originalEnv };
		clearMockDateCookie();
	});

	afterEach(() => {
		clearMockDateCookie();
	});

	afterAll(() => {
		process.env = originalEnv;
	});

	it("returns the mocked date when MOCK_DATE is set", () => {
		const mockDateString = "2024-06-27T12:00:00.000Z";
		process.env.MOCK_DATE = mockDateString;

		const result = getCurrentDate();

		expect(result.toISOString()).toBe(mockDateString);
	});

	it("returns current date when MOCK_DATE is not set", () => {
		delete process.env.MOCK_DATE;

		const before = new Date();
		const result = getCurrentDate();
		const after = new Date();

		expect(result.getTime()).toBeGreaterThanOrEqual(before.getTime());
		expect(result.getTime()).toBeLessThanOrEqual(after.getTime());
	});

	it("returns current date when MOCK_DATE is empty string", () => {
		process.env.MOCK_DATE = "";

		const before = new Date();
		const result = getCurrentDate();
		const after = new Date();

		// Empty string is falsy, so it should return current date
		expect(result.getTime()).toBeGreaterThanOrEqual(before.getTime());
		expect(result.getTime()).toBeLessThanOrEqual(after.getTime());
	});

	it("returns the mocked date from the mock-date cookie in the browser", () => {
		delete process.env.MOCK_DATE;
		const mockDateString = "2024-06-27T12:00:00.000Z";
		// The dev API sets the cookie percent-encoded.
		document.cookie = `mock-date=${encodeURIComponent(mockDateString)}`;

		const result = getCurrentDate();

		expect(result.toISOString()).toBe(mockDateString);
	});

	it("prefers MOCK_DATE over the cookie", () => {
		process.env.MOCK_DATE = "2024-06-27T12:00:00.000Z";
		document.cookie = "mock-date=2020-01-01T00:00:00.000Z";

		const result = getCurrentDate();

		expect(result.toISOString()).toBe("2024-06-27T12:00:00.000Z");
	});

	it("ignores the mock-date cookie in production", () => {
		delete process.env.MOCK_DATE;
		// NODE_ENV is typed read-only; assign through a mutable view of process.env.
		const env = process.env as Record<string, string | undefined>;
		const originalNodeEnv = env.NODE_ENV;
		env.NODE_ENV = "production";
		try {
			document.cookie = "mock-date=2024-06-27T12:00:00.000Z";

			const before = new Date();
			const result = getCurrentDate();
			const after = new Date();

			expect(result.getTime()).toBeGreaterThanOrEqual(before.getTime());
			expect(result.getTime()).toBeLessThanOrEqual(after.getTime());
		} finally {
			env.NODE_ENV = originalNodeEnv;
		}
	});

	it("ignores an empty mock-date cookie value", () => {
		delete process.env.MOCK_DATE;
		document.cookie = "mock-date=";

		const before = new Date();
		const result = getCurrentDate();
		const after = new Date();

		expect(result.getTime()).toBeGreaterThanOrEqual(before.getTime());
		expect(result.getTime()).toBeLessThanOrEqual(after.getTime());
	});

});
