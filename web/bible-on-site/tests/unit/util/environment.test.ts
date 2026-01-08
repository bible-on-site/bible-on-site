import { isProduction } from "../../../src/util/environment";

describe("isProduction", () => {
	const originalEnv = process.env.NEXT_PUBLIC_ENV;

	afterEach(() => {
		// Restore original env
		if (originalEnv === undefined) {
			delete process.env.NEXT_PUBLIC_ENV;
		} else {
			process.env.NEXT_PUBLIC_ENV = originalEnv;
		}
	});

	it("returns true when NEXT_PUBLIC_ENV is 'production'", () => {
		process.env.NEXT_PUBLIC_ENV = "production";
		expect(isProduction()).toBe(true);
	});

	it("returns false when NEXT_PUBLIC_ENV is not 'production'", () => {
		process.env.NEXT_PUBLIC_ENV = "development";
		expect(isProduction()).toBe(false);
	});

	it("returns false when NEXT_PUBLIC_ENV is undefined", () => {
		delete process.env.NEXT_PUBLIC_ENV;
		expect(isProduction()).toBe(false);
	});
});
