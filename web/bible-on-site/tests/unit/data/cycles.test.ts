import { cycles } from "../../../src/data/db/cycles";

describe("cycles", () => {
	it("should be an array", () => {
		expect(Array.isArray(cycles)).toBe(true);
	});

	it("should contain numbers", () => {
		cycles.forEach((cycle) => {
			expect(typeof cycle).toBe("number");
		});
	});

	it("should have entries (not be empty)", () => {
		expect(cycles.length).toBeGreaterThan(0);
	});

	it("should contain valid date values (positive integers)", () => {
		cycles.forEach((cycle) => {
			expect(Number.isInteger(cycle)).toBe(true);
			expect(cycle).toBeGreaterThan(0);
		});
	});
});
