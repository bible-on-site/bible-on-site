import { type APIResponse, expect, test } from "@playwright/test";

const ROOT_URL = "http://127.0.0.1:3003";

test.describe("StarterService", () => {
	test.describe("starter", () => {
		test("returns starter data with authors and article counts", async ({
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
						"{\n  starter {\n    authors {\n      id\n      name\n      details\n    }\n    perekArticlesCounters\n  }\n}\n",
				},
			});
			const responseBody = await response.json();

			// Verify structure
			expect(responseBody.data).toBeDefined();
			expect(responseBody.data.starter).toBeDefined();
			expect(responseBody.data.starter.authors).toBeDefined();
			expect(responseBody.data.starter.perekArticlesCounters).toBeDefined();

			// Verify authors array
			expect(Array.isArray(responseBody.data.starter.authors)).toBe(true);
			expect(responseBody.data.starter.authors.length).toBe(4); // We have 4 test authors

			// Verify first author
			expect(responseBody.data.starter.authors[0]).toMatchObject({
				id: 1,
				name: 'הרב לדוגמא שליט"א',
				details: "תיאור לדוגמא",
			});

			// Verify perekArticlesCounters is array of 929 elements
			expect(
				Array.isArray(responseBody.data.starter.perekArticlesCounters),
			).toBe(true);
			expect(responseBody.data.starter.perekArticlesCounters.length).toBe(929);

			// Verify first perek has 4 articles (our test data has 4 articles for perek_id=1)
			expect(responseBody.data.starter.perekArticlesCounters[0]).toBe(4);

			// Verify other perakim have 0 articles
			expect(responseBody.data.starter.perekArticlesCounters[1]).toBe(0);
			expect(responseBody.data.starter.perekArticlesCounters[928]).toBe(0);
		});

		test("returns all authors with correct fields", async ({ request }) => {
			const response: APIResponse = await request.post(ROOT_URL, {
				headers: {
					"Content-Type": "application/json",
				},
				data: {
					operationName: null,
					variables: {},
					query:
						"{\n  starter {\n    authors {\n      id\n      name\n      details\n    }\n  }\n}\n",
				},
			});
			const responseBody = await response.json();

			const authors = responseBody.data.starter.authors;
			expect(authors).toHaveLength(4);

			// Check all authors have required fields
			for (const author of authors) {
				expect(author.id).toBeDefined();
				expect(author.name).toBeDefined();
				expect(author.details).toBeDefined();
			}

			// Check specific author with long details
			const authorWithLongDetails = authors.find(
				(a: { name: string }) => a.name === 'רב עם תיאור ארוך ז"ל',
			);
			expect(authorWithLongDetails).toBeDefined();
			expect(authorWithLongDetails.details).toContain("מאוד");
		});

		test("returns correct perekArticlesCounters length", async ({
			request,
		}) => {
			const response: APIResponse = await request.post(ROOT_URL, {
				headers: {
					"Content-Type": "application/json",
				},
				data: {
					operationName: null,
					variables: {},
					query: "{\n  starter {\n    perekArticlesCounters\n  }\n}\n",
				},
			});
			const responseBody = await response.json();

			// Must be exactly 929 elements (one for each perek in the 929 project)
			expect(responseBody.data.starter.perekArticlesCounters).toHaveLength(929);

			// All values should be non-negative integers
			for (const count of responseBody.data.starter.perekArticlesCounters) {
				expect(typeof count).toBe("number");
				expect(count).toBeGreaterThanOrEqual(0);
			}
		});

		test("returns articlesCount for each author", async ({ request }) => {
			const response: APIResponse = await request.post(ROOT_URL, {
				headers: {
					"Content-Type": "application/json",
				},
				data: {
					operationName: null,
					variables: {},
					query:
						"{\n  starter {\n    authors {\n      id\n      name\n      articlesCount\n    }\n  }\n}\n",
				},
			});
			const responseBody = await response.json();

			const authors = responseBody.data.starter.authors;
			expect(authors).toHaveLength(4);

			// Check all authors have articlesCount
			for (const author of authors) {
				expect(author.articlesCount).toBeDefined();
				expect(typeof author.articlesCount).toBe("number");
				expect(author.articlesCount).toBeGreaterThanOrEqual(0);
			}

			// Test data: author 1 has 1 article, author 2 has 2 articles
			const author1 = authors.find((a: { id: number }) => a.id === 1);
			expect(author1).toBeDefined();
			expect(author1.articlesCount).toBe(1);

			const author2 = authors.find((a: { id: number }) => a.id === 2);
			expect(author2).toBeDefined();
			expect(author2.articlesCount).toBe(2);

			// Author 3 has no articles
			const author3 = authors.find((a: { id: number }) => a.id === 3);
			expect(author3).toBeDefined();
			expect(author3.articlesCount).toBe(0);
		});
	});
});
