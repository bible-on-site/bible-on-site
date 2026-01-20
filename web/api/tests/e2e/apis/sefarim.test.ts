import { type APIResponse, expect, test } from "@playwright/test";

const ROOT_URL = "http://127.0.0.1:3003";

test.describe("SefarimService", () => {
	test.describe("seferById", () => {
		test("returns a sefer with simple tanachUsName", async ({ request }) => {
			const response: APIResponse = await request.post(ROOT_URL, {
				headers: {
					"Content-Type": "application/json",
				},
				data: {
					operationName: null,
					variables: {},
					query:
						"{\n  seferById(id: 1) {\n    id\n    name\n    tanachUsName\n  }\n}\n",
				},
			});
			const responseBody = await response.json();
			expect(responseBody).toMatchObject({
				data: {
					seferById: {
						id: 1,
						name: "בראשית",
						tanachUsName: "Genesis",
					},
				},
			});
		});

		test("returns a sefer with additionals JSON tanachUsName", async ({
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
						"{\n  seferById(id: 8) {\n    id\n    name\n    tanachUsName\n  }\n}\n",
				},
			});
			const responseBody = await response.json();
			expect(responseBody).toMatchObject({
				data: {
					seferById: {
						id: 8,
						name: "שמואל",
						tanachUsName: null,
					},
				},
			});
		});

		test("returns error for non-existent sefer", async ({ request }) => {
			const response: APIResponse = await request.post(ROOT_URL, {
				headers: {
					"Content-Type": "application/json",
				},
				data: {
					operationName: null,
					variables: {},
					query:
						"{\n  seferById(id: 999) {\n    id\n    name\n    tanachUsName\n  }\n}\n",
				},
			});
			const responseBody = await response.json();
			expect(responseBody.errors).toBeDefined();
			expect(responseBody.errors[0].message).toBe("Sefer Not Found");
			expect(responseBody.errors[0].extensions).toMatchObject({
				code: "NOT_FOUND",
				statusCode: 404,
			});
		});
	});

	test.describe("sefarim", () => {
		test("returns all sefarim", async ({ request }) => {
			const response: APIResponse = await request.post(ROOT_URL, {
				headers: {
					"Content-Type": "application/json",
				},
				data: {
					operationName: null,
					variables: {},
					query: "{\n  sefarim {\n    id\n    name\n    tanachUsName\n  }\n}\n",
				},
			});
			const responseBody = await response.json();
			expect(responseBody.data.sefarim).toBeDefined();
			expect(Array.isArray(responseBody.data.sefarim)).toBe(true);
			expect(responseBody.data.sefarim.length).toBeGreaterThanOrEqual(5);

			// Verify בראשית is included
			const bereshit = responseBody.data.sefarim.find(
				(s: { id: number }) => s.id === 1,
			);
			expect(bereshit).toMatchObject({
				id: 1,
				name: "בראשית",
				tanachUsName: "Genesis",
			});
		});
	});
});
