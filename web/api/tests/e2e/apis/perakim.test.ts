import { type APIResponse, expect, test } from "@playwright/test";

const ROOT_URL = "http://127.0.0.1:3003/api/graphql";

test.describe("PerakimService", () => {
	test.describe("perekByPerekId", () => {
		test("returns a perek by perek ID", async ({ request }) => {
			const response: APIResponse = await request.post(ROOT_URL, {
				headers: {
					"Content-Type": "application/json",
				},
				data: {
					operationName: null,
					variables: {},
					query:
						"{\n  perekByPerekId(perekId: 1) {\n    id\n    perekId\n    seferId\n    additional\n    perek\n    date\n    hebdate\n    tseit\n    header\n    source\n  }\n}\n",
				},
			});
			const responseBody = await response.json();
			expect(responseBody).toMatchObject({
				data: {
					perekByPerekId: {
						id: 1,
						perekId: 1,
						seferId: 1,
						additional: null,
						perek: 1,
						date: "2022-02-06",
						hebdate: "ה׳ אַדָר א׳ תשפ״ב",
						header: "בריאת העולם",
						source: "בראשית א",
					},
				},
			});
			// tseit is a time field, just check it exists
			expect(responseBody.data.perekByPerekId.tseit).toBeDefined();
		});

		test("returns a perek with additional (שמואל א)", async ({ request }) => {
			const response: APIResponse = await request.post(ROOT_URL, {
				headers: {
					"Content-Type": "application/json",
				},
				data: {
					operationName: null,
					variables: {},
					query:
						"{\n  perekByPerekId(perekId: 233) {\n    id\n    perekId\n    seferId\n    additional\n    perek\n    header\n  }\n}\n",
				},
			});
			const responseBody = await response.json();
			expect(responseBody).toMatchObject({
				data: {
					perekByPerekId: {
						perekId: 233,
						seferId: 8,
						additional: 1,
						perek: 1,
					},
				},
			});
		});

		test("returns error for non-existent perek", async ({ request }) => {
			const response: APIResponse = await request.post(ROOT_URL, {
				headers: {
					"Content-Type": "application/json",
				},
				data: {
					operationName: null,
					variables: {},
					query:
						"{\n  perekByPerekId(perekId: 9999) {\n    id\n    perekId\n  }\n}\n",
				},
			});
			const responseBody = await response.json();
			expect(responseBody.errors).toBeDefined();
			expect(responseBody.errors[0].message).toBe("Perek Not Found");
			expect(responseBody.errors[0].extensions).toMatchObject({
				code: "NOT_FOUND",
				statusCode: 404,
			});
		});
	});

	test.describe("perakim", () => {
		test("returns all perakim", async ({ request }) => {
			const response: APIResponse = await request.post(ROOT_URL, {
				headers: {
					"Content-Type": "application/json",
				},
				data: {
					operationName: null,
					variables: {},
					query: "{\n  perakim {\n    id\n    perekId\n    seferId\n  }\n}\n",
				},
			});
			const responseBody = await response.json();
			expect(responseBody.data.perakim).toBeDefined();
			expect(responseBody.data.perakim.length).toBe(929);
			// Verify first perek
			expect(responseBody.data.perakim[0]).toMatchObject({
				id: 1,
				perekId: 1,
				seferId: 1,
			});
		});
	});

	test.describe("perakimBySeferId", () => {
		test("returns all perakim for a sefer", async ({ request }) => {
			const response: APIResponse = await request.post(ROOT_URL, {
				headers: {
					"Content-Type": "application/json",
				},
				data: {
					operationName: null,
					variables: {},
					query:
						"{\n  perakimBySeferId(seferId: 1) {\n    id\n    perekId\n    seferId\n    perek\n  }\n}\n",
				},
			});
			const responseBody = await response.json();
			expect(responseBody.data.perakimBySeferId).toBeDefined();
			expect(responseBody.data.perakimBySeferId.length).toBe(50);
			// All should be from sefer 1 (בראשית)
			for (const perek of responseBody.data.perakimBySeferId) {
				expect(perek.seferId).toBe(1);
			}
		});

		test("returns perakim with additionals for שמואל", async ({ request }) => {
			const response: APIResponse = await request.post(ROOT_URL, {
				headers: {
					"Content-Type": "application/json",
				},
				data: {
					operationName: null,
					variables: {},
					query:
						"{\n  perakimBySeferId(seferId: 8) {\n    id\n    perekId\n    seferId\n    additional\n    perek\n  }\n}\n",
				},
			});
			const responseBody = await response.json();
			expect(responseBody.data.perakimBySeferId).toBeDefined();
			expect(responseBody.data.perakimBySeferId.length).toBe(55);
			// Check that we have both שמואל א (additional=1) and שמואל ב (additional=2)
			const additionals = responseBody.data.perakimBySeferId.map(
				(p: { additional: number | null }) => p.additional,
			);
			expect(additionals).toContain(1);
			expect(additionals).toContain(2);
		});

		test("returns empty array for sefer with no perakim", async ({
			request,
		}) => {
			const response: APIResponse = await request.post(ROOT_URL, {
				headers: {
					"Content-Type": "application/json",
				},
				data: {
					operationName: null,
					variables: {},
					query:
						"{\n  perakimBySeferId(seferId: 999) {\n    id\n    perekId\n  }\n}\n",
				},
			});
			const responseBody = await response.json();
			expect(responseBody.data.perakimBySeferId).toBeDefined();
			expect(responseBody.data.perakimBySeferId.length).toBe(0);
		});
	});
});
