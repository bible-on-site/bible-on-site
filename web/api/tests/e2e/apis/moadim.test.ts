import { type APIResponse, expect, test } from "@playwright/test";

const ROOT_URL = "http://127.0.0.1:3003";

/**
 * #3261 real-database coverage for the מועדים catalogue. The fixtures in
 * tanah_test_data.sql add moadim 90/92 (published) and 91 (draft) plus the
 * article links that exercise every union branch:
 *   article 1 — linked AND range-matched (deduplicates to one entry)
 *   articles 2-4 — range-matched only (unverified primary-perek fallback)
 *   article 5 — linked but excluded: its primary perek (5000) is not a
 *   routable public chapter, so the link alone cannot resurrect a dead
 *   route (mirrors getMoedArticleSummaries on the website)
 *   article 3 — the explicit-only link on moed 92
 */
test.describe("MoedService", () => {
	test.describe("moadim", () => {
		test("returns published moadim in wheel order with ordered sections and ranges", async ({
			request,
		}) => {
			const response: APIResponse = await request.post(ROOT_URL, {
				data: {
					query:
						"{ moadim { id slug name annualOrder published sections { id label position ranges { id perekIdStart pasukStart perekIdEnd pasukEnd } } explicitArticleIds } }",
				},
			});
			const body = await response.json();
			expect(body.errors).toBeUndefined();
			const moadim = body.data.moadim as Array<{
				id: number;
				slug: string;
				annualOrder: number;
				published: boolean;
				sections: Array<{
					label: string;
					position: number;
					ranges: Array<{
						perekIdStart: number;
						pasukStart: number;
						perekIdEnd: number;
						pasukEnd: number;
					}>;
				}>;
			}>;
			expect(moadim.length).toBeGreaterThanOrEqual(3);
			const orders = moadim.map((moed) => moed.annualOrder);
			expect(orders).toEqual([...orders].sort((a, b) => a - b));
			// The unpublished fixture draft never reaches the public list.
			expect(moadim.every((moed) => moed.published)).toBe(true);
			expect(moadim.map((moed) => moed.id)).not.toContain(91);

			const fixture = moadim.find((moed) => moed.id === 90);
			expect(fixture).toMatchObject({
				slug: "מועד-בדיקה",
				annualOrder: 90,
				sections: [
					{
						label: "סעיף בדיקה",
						position: 1,
						ranges: [
							{
								perekIdStart: 1,
								pasukStart: 1,
								perekIdEnd: 1,
								pasukEnd: 3,
							},
						],
					},
				],
			});
		});
	});

	test.describe("moed", () => {
		test("resolves the aggregate and the deduplicated article union", async ({
			request,
		}) => {
			const response: APIResponse = await request.post(ROOT_URL, {
				data: {
					query:
						'{ moed(slug: "מועד-בדיקה") { id slug name explicitArticleIds sections { label ranges { perekIdStart pasukStart perekIdEnd pasukEnd } } articles { id } } }',
				},
			});
			const body = await response.json();
			expect(body.errors).toBeUndefined();
			expect(body.data.moed).toMatchObject({
				id: 90,
				slug: "מועד-בדיקה",
				name: "מועד בדיקה",
				// The raw junction ids stay visible even for a dead-route link.
				explicitArticleIds: [1, 5],
			});
			const articleIds = (body.data.moed.articles as Array<{ id: number }>).map(
				(article) => article.id,
			);
			// Article 1 lists once despite matching via link AND range; the
			// dead-route article 5 cannot be resurrected by its link alone.
			expect(articleIds).toEqual([1, 2, 3, 4]);
		});

		test("returns an explicit-link article whose range matches nothing", async ({
			request,
		}) => {
			const response: APIResponse = await request.post(ROOT_URL, {
				data: {
					query:
						'{ moed(slug: "מועד-בדיקה-קישור") { id articles { id } } }',
				},
			});
			const body = await response.json();
			expect(body.errors).toBeUndefined();
			expect(
				(body.data.moed.articles as Array<{ id: number }>).map(
					(article) => article.id,
				),
			).toEqual([3]);
		});

		test("answers null for an unpublished draft and for an unknown slug", async ({
			request,
		}) => {
			const response: APIResponse = await request.post(ROOT_URL, {
				data: {
					query:
						'{ draft: moed(slug: "מועד-לא-מפורסם") { id } missing: moed(slug: "אין-כזה") { id } }',
				},
			});
			const body = await response.json();
			expect(body.errors).toBeUndefined();
			expect(body.data.draft).toBeNull();
			expect(body.data.missing).toBeNull();
		});
	});

	test.describe("moadimAdmin", () => {
		test("rejects a missing bearer key over HTTP", async ({ request }) => {
			const response: APIResponse = await request.post(ROOT_URL, {
				data: { query: "{ moadimAdmin { id } }" },
			});
			const body = await response.json();
			expect(body.data).toBeNull();
			expect(body.errors).toHaveLength(1);
			expect(body.errors[0].extensions.code).toBe("UNAUTHORIZED");
		});
	});
});
