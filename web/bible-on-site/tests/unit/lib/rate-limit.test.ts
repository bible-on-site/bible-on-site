/** @jest-environment node */
jest.mock("server-only", () => ({}));

import { createRateLimiter, requestClientKey } from "@/lib/rate-limit";

describe("createRateLimiter", () => {
	it("permits up to the limit within the window then refuses", () => {
		const allowed = createRateLimiter(2, 60_000);

		expect(allowed("ip", 1_000)).toBe(true);
		expect(allowed("ip", 2_000)).toBe(true);
		expect(allowed("ip", 3_000)).toBe(false);
		expect(allowed("ip", 59_000)).toBe(false);
	});

	it("opens a fresh window once the current one expires", () => {
		const allowed = createRateLimiter(1, 60_000);

		expect(allowed("ip", 1_000)).toBe(true);
		expect(allowed("ip", 2_000)).toBe(false);
		expect(allowed("ip", 61_000)).toBe(true);
	});

	it("tracks keys independently", () => {
		const allowed = createRateLimiter(1, 60_000);

		expect(allowed("a", 1_000)).toBe(true);
		expect(allowed("a", 2_000)).toBe(false);
		expect(allowed("b", 2_000)).toBe(true);
	});

	it("refuses new keys once the live bucket map is full", () => {
		const allowed = createRateLimiter(1, 60_000, 3);
		allowed("a", 1_000);
		allowed("b", 1_000);
		allowed("c", 1_000);

		expect(allowed("d", 2_000)).toBe(false);

		// After the window passes the map prunes and admits keys again.
		expect(allowed("d", 62_000)).toBe(true);
	});
});

describe("requestClientKey", () => {
	it("uses the router-supplied X-Real-IP, never a forged X-Forwarded-For", () => {
		const request = new Request("http://localhost/api/push/device", {
			method: "POST",
			headers: {
				"x-real-ip": "203.0.113.9",
				"x-forwarded-for": "198.51.100.1",
			},
		});
		expect(requestClientKey(request)).toBe("203.0.113.9");
	});

	it("shares one bucket for traffic without a router address", () => {
		const request = new Request("http://localhost/api/push/device", {
			method: "POST",
		});
		expect(requestClientKey(request)).toBe("unknown");
	});
});
