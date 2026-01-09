import { expect, test } from "@playwright/test";

test.describe("/api/health", () => {
	test("returns 200 with status ok", async ({ request }) => {
		const response = await request.get("/api/health");

		expect(response.status()).toBe(200);
		expect(response.headers()["content-type"]).toContain("application/json");

		const body = await response.json();
		expect(body).toEqual({ status: "ok" });
	});
});

test.describe("/api/health/ready", () => {
	test("returns 200 with status ready and warmed flag", async ({ request }) => {
		const response = await request.get("/api/health/ready");

		expect(response.status()).toBe(200);
		expect(response.headers()["content-type"]).toContain("application/json");

		const body = await response.json();
		expect(body).toEqual({
			status: "ready",
			warmed: true,
		});
	});

	test("warms critical paths on first call", async ({ request }) => {
		// First call should warm the paths
		const response1 = await request.get("/api/health/ready");
		expect(response1.status()).toBe(200);
		const body1 = await response1.json();
		expect(body1.warmed).toBe(true);

		// Subsequent calls should also return warmed: true
		const response2 = await request.get("/api/health/ready");
		expect(response2.status()).toBe(200);
		const body2 = await response2.json();
		expect(body2.warmed).toBe(true);
	});
});
