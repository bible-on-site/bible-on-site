import { expect, test } from "@playwright/test";

const ROOT_URL = "http://127.0.0.1:3003";

test.describe("Health endpoint", () => {
	test("HEAD /health succeeds without a response body", async ({ request }) => {
		const response = await request.head(`${ROOT_URL}/health`);
		expect(response.status()).toBe(200);
		expect(response.headers()["content-type"]).toBe("application/json");
		expect((await response.body()).length).toBe(0);
	});

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
