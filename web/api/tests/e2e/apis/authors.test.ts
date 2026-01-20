import { type APIResponse, expect, test } from "@playwright/test";

const ROOT_URL = "http://127.0.0.1:3003";

test.describe("AuthorsService", () => {
	test.describe("authorById", () => {
		test("returns an author by ID", async ({ request }) => {
			const response: APIResponse = await request.post(ROOT_URL, {
				headers: {
					"Content-Type": "application/json",
				},
				data: {
					operationName: null,
					variables: {},
					query:
						"{\n  authorById(id: 1) {\n    id\n    name\n    details\n  }\n}\n",
				},
			});
			const responseBody = await response.json();
			expect(responseBody).toMatchObject({
				data: {
					authorById: {
						id: 1,
						name: 'הרב לדוגמא שליט"א',
						details: "תיאור לדוגמא",
					},
				},
			});
		});

		test("returns articlesCount for an individual author (on-demand computed)", async ({
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
						"{\n  authorById(id: 1) {\n    id\n    name\n    articlesCount\n  }\n}\n",
				},
			});
			const responseBody = await response.json();
			expect(responseBody.data.authorById).toMatchObject({
				id: 1,
				name: 'הרב לדוגמא שליט"א',
				articlesCount: 1, // Test data: author 1 has 1 article
			});
		});

		test("returns articlesCount of 0 for author with no articles", async ({
			request,
		}) => {
			// Author 3 has no articles in test data
			const response: APIResponse = await request.post(ROOT_URL, {
				headers: {
					"Content-Type": "application/json",
				},
				data: {
					operationName: null,
					variables: {},
					query:
						"{\n  authorById(id: 3) {\n    id\n    articlesCount\n  }\n}\n",
				},
			});
			const responseBody = await response.json();
			expect(responseBody.data.authorById.articlesCount).toBe(0);
		});
	});
});
