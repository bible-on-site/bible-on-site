import { expect, test } from "@playwright/test";

const ROOT_URL = "http://127.0.0.1:3003";

test.describe("Health endpoint", () => {
	test("GET /health returns status ok and a version string", async ({
		request,
	}) => {
		const response = await request.get(`${ROOT_URL}/health`);
		expect(response.status()).toBe(200);

		const body = await response.json();
		expect(body.status).toBe("ok");
		expect(typeof body.version).toBe("string");
		expect(body.version.length).toBeGreaterThan(0);
	});
});
