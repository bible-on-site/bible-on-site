/** @jest-environment node */
import { getCurrentDate } from "../../../src/util/date";

describe("getCurrentDate (server, no document)", () => {
	const originalMockDate = process.env.MOCK_DATE;

	afterAll(() => {
		if (originalMockDate === undefined) {
			delete process.env.MOCK_DATE;
		} else {
			process.env.MOCK_DATE = originalMockDate;
		}
	});

	it("returns the mocked date when MOCK_DATE is set", () => {
		process.env.MOCK_DATE = "2024-06-27T12:00:00.000Z";

		expect(getCurrentDate().toISOString()).toBe("2024-06-27T12:00:00.000Z");
	});

	it("returns current date when MOCK_DATE is not set", () => {
		delete process.env.MOCK_DATE;

		const before = new Date();
		const result = getCurrentDate();
		const after = new Date();

		expect(result.getTime()).toBeGreaterThanOrEqual(before.getTime());
		expect(result.getTime()).toBeLessThanOrEqual(after.getTime());
	});
});
