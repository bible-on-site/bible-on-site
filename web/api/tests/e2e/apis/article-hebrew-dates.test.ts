import { type APIResponse, expect, test } from "@playwright/test";

const ROOT_URL = "http://127.0.0.1:3003";

const query = (gql: string) => ({
	headers: { "Content-Type": "application/json" },
	data: { operationName: null, variables: {}, query: gql },
});

// Fixture assignments (data/mysql/tanah_test_data.sql): article 2 -> 9 Av
// (11,9) and article 3 -> 5 Iyar (8,5). Article 2's primary perek is 1, so the
// override intentionally crosses the scheduled-perek boundary (#3098).
test.describe("ArticlesService Hebrew-date overrides (#3098)", () => {
	test("returns the assigned article for 9 Av regardless of perek", async ({
		request,
	}) => {
		const response: APIResponse = await request.post(
			ROOT_URL,
			query(
				"{\n  articleByHebrewDate(hebrewMonth: 11, hebrewDay: 9) {\n    id\n    perekId\n    authorId\n    name\n  }\n}\n",
			),
		);
		const body = await response.json();
		expect(body).toMatchObject({
			data: {
				articleByHebrewDate: {
					id: 2,
					perekId: 1,
					name: 'מאמר של הרב לדוגמא ז"ל על בראשית א',
				},
			},
		});
	});

	test("returns the assigned article for 5 Iyar", async ({ request }) => {
		const response: APIResponse = await request.post(
			ROOT_URL,
			query(
				"{\n  articleByHebrewDate(hebrewMonth: 8, hebrewDay: 5) {\n    id\n    name\n  }\n}\n",
			),
		);
		const body = await response.json();
		expect(body).toMatchObject({
			data: {
				articleByHebrewDate: {
					id: 3,
					name: 'מאמר שני של הרב לדוגמא ז"ל על בראשית א',
				},
			},
		});
	});

	test("returns null for a neighboring date with no assignment", async ({
		request,
	}) => {
		for (const [month, day] of [
			[11, 8],
			[11, 10],
			[8, 4],
			[8, 6],
		]) {
			const response: APIResponse = await request.post(
				ROOT_URL,
				query(
					`{\n  articleByHebrewDate(hebrewMonth: ${month}, hebrewDay: ${day}) {\n    id\n  }\n}\n`,
				),
			);
			const body = await response.json();
			expect(body.data.articleByHebrewDate).toBeNull();
		}
	});

	test("rejects invalid Hebrew dates", async ({ request }) => {
		for (const [month, day] of [
			[0, 1],
			[15, 1],
			[11, 31],
			[4, 30], // Tevet never has 30 days
		]) {
			const response: APIResponse = await request.post(
				ROOT_URL,
				query(
					`{\n  articleByHebrewDate(hebrewMonth: ${month}, hebrewDay: ${day}) {\n    id\n  }\n}\n`,
				),
			);
			const body = await response.json();
			expect(body.errors).toBeDefined();
			expect(body.errors[0].extensions).toMatchObject({
				code: "BAD_REQUEST",
				statusCode: 400,
			});
		}
	});

	test("starter exposes every assignment for offline-native caching", async ({
		request,
	}) => {
		const response: APIResponse = await request.post(
			ROOT_URL,
			query(
				"{\n  starter {\n    articleHebrewDateOverrides {\n      articleId\n      hebrewMonth\n      hebrewDay\n    }\n  }\n}\n",
			),
		);
		const body = await response.json();
		const overrides =
			body.data.starter.articleHebrewDateOverrides as Array<{
				articleId: number;
				hebrewMonth: number;
				hebrewDay: number;
			}>;
		expect(overrides).toContainEqual({
			articleId: 2,
			hebrewMonth: 11,
			hebrewDay: 9,
		});
		expect(overrides).toContainEqual({
			articleId: 3,
			hebrewMonth: 8,
			hebrewDay: 5,
		});
	});
});
