import { type APIResponse, expect, test } from "@playwright/test";

const ROOT_URL = "http://127.0.0.1:3003/api/graphql";

test.describe("Compression", () => {
	test("returns brotli-compressed response when Accept-Encoding: br is sent", async ({
		request,
	}) => {
		const response: APIResponse = await request.post(ROOT_URL, {
			headers: {
				"Content-Type": "application/json",
				"Accept-Encoding": "br",
			},
			data: {
				operationName: null,
				variables: {},
				query: "{\n  sefarim {\n    id\n    name\n    tanachUsName\n  }\n}\n",
			},
		});

		expect(response.status()).toBe(200);
		expect(response.headers()["content-encoding"]).toBe("br");

		// Playwright automatically decompresses, so we can still read the JSON
		const responseBody = await response.json();
		expect(responseBody.data.sefarim).toBeDefined();
		expect(responseBody.data.sefarim.length).toBeGreaterThan(0);
	});

	test("returns uncompressed response when no Accept-Encoding is sent", async ({
		request,
	}) => {
		const response: APIResponse = await request.post(ROOT_URL, {
			headers: {
				"Content-Type": "application/json",
				"Accept-Encoding": "identity",
			},
			data: {
				operationName: null,
				variables: {},
				query: "{\n  sefarim {\n    id\n    name\n    tanachUsName\n  }\n}\n",
			},
		});

		expect(response.status()).toBe(200);
		// No content-encoding header means uncompressed
		expect(response.headers()["content-encoding"]).toBeUndefined();

		const responseBody = await response.json();
		expect(responseBody.data.sefarim).toBeDefined();
	});
});
