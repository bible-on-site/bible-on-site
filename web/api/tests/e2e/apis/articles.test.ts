import { type APIResponse, expect, test } from "@playwright/test";

const ROOT_URL = "http://127.0.0.1:3003";

test.describe("ArticlesService", () => {
	test.describe("articleById", () => {
		test("returns an article by ID", async ({ request }) => {
			const response: APIResponse = await request.post(ROOT_URL, {
				headers: {
					"Content-Type": "application/json",
				},
				data: {
					operationName: null,
					variables: {},
					query:
						"{\n  articleById(id: 1) {\n    id\n    perekId\n    authorId\n    abstract\n    name\n    priority\n  }\n}\n",
				},
			});
			const responseBody = await response.json();
			expect(responseBody).toMatchObject({
				data: {
					articleById: {
						id: 1,
						perekId: 1,
						authorId: 1,
						abstract: "<h1>בראשית ברא - עיון בפסוק הראשון</h1>",
						name: "בראשית ברא - עיון בפסוק הראשון",
						priority: 1,
					},
				},
			});
		});

		test("returns error for non-existent article", async ({ request }) => {
			const response: APIResponse = await request.post(ROOT_URL, {
				headers: {
					"Content-Type": "application/json",
				},
				data: {
					operationName: null,
					variables: {},
					query: "{\n  articleById(id: 9999) {\n    id\n    name\n  }\n}\n",
				},
			});
			const responseBody = await response.json();
			expect(responseBody.errors).toBeDefined();
			expect(responseBody.errors[0].message).toBe("Article Not Found");
			expect(responseBody.errors[0].extensions).toMatchObject({
				code: "NOT_FOUND",
				statusCode: 404,
			});
		});
	});

	test.describe("articlesByPerekId", () => {
		test("returns all articles for a perek", async ({ request }) => {
			const response: APIResponse = await request.post(ROOT_URL, {
				headers: {
					"Content-Type": "application/json",
				},
				data: {
					operationName: null,
					variables: {},
					query:
						"{\n  articlesByPerekId(perekId: 1) {\n    id\n    perekId\n    authorId\n    name\n  }\n}\n",
				},
			});
			const responseBody = await response.json();
			expect(responseBody.data.articlesByPerekId).toBeDefined();
			expect(Array.isArray(responseBody.data.articlesByPerekId)).toBe(true);
			// Test data has 4 articles for perek 1
			expect(responseBody.data.articlesByPerekId.length).toBe(4);
			// All should have perekId = 1
			for (const article of responseBody.data.articlesByPerekId) {
				expect(article.perekId).toBe(1);
			}
		});

		test("returns empty array for perek with no articles", async ({
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
						"{\n  articlesByPerekId(perekId: 999) {\n    id\n    name\n  }\n}\n",
				},
			});
			const responseBody = await response.json();
			expect(responseBody.data.articlesByPerekId).toEqual([]);
		});
	});

	test.describe("articlesByAuthorId", () => {
		test("returns all articles by an author", async ({ request }) => {
			const response: APIResponse = await request.post(ROOT_URL, {
				headers: {
					"Content-Type": "application/json",
				},
				data: {
					operationName: null,
					variables: {},
					query:
						"{\n  articlesByAuthorId(authorId: 2) {\n    id\n    perekId\n    authorId\n    name\n  }\n}\n",
				},
			});
			const responseBody = await response.json();
			expect(responseBody.data.articlesByAuthorId).toBeDefined();
			expect(Array.isArray(responseBody.data.articlesByAuthorId)).toBe(true);
			// Test data has 2 articles for author 2
			expect(responseBody.data.articlesByAuthorId.length).toBe(2);
			// All should have authorId = 2
			for (const article of responseBody.data.articlesByAuthorId) {
				expect(article.authorId).toBe(2);
			}
		});

		test("returns empty array for author with no articles", async ({
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
						"{\n  articlesByAuthorId(authorId: 999) {\n    id\n    name\n  }\n}\n",
				},
			});
			const responseBody = await response.json();
			expect(responseBody.data.articlesByAuthorId).toEqual([]);
		});
	});
});
