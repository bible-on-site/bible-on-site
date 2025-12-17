import { getCurrentDate } from "../../../src/util/date";

describe("getCurrentDate", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		jest.resetModules();
		process.env = { ...originalEnv };
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
});
