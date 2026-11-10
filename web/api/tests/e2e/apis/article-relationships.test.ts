import { expect, test } from "@playwright/test";

/**
 * #3102 authorization e2e — every article-relationship operation requires
 * `Authorization: Bearer <ARTICLE_API_KEY>` and must fail closed when the
 * server variable is unset (the test environment defines no key) or the
 * presented token mismatches.
 */
const operations = [
	{
		field: "articleRelationshipCapabilities",
		query: "{ articleRelationshipCapabilities { contractVersion } }",
	},
	{
		field: "articleRelationships",
		query: "{ articleRelationships(articleId: 1) { articleId } }",
	},
	{
		field: "articleRelationshipTargets",
		query: '{ articleRelationshipTargets(kind: PEREK, query: "בראשית") { id } }',
	},
	{
		field: "updateArticleRelationships",
		query: 'mutation { updateArticleRelationships(articleId: 1, input: { source: "e2e" }) { revalidation } }',
	},
];

for (const authorization of [undefined, "Bearer invalid-fixture-key"]) {
	for (const operation of operations) {
		test(`${operation.field} rejects ${authorization ? "an invalid" : "a missing"} bearer key over HTTP`, async ({
			request,
		}) => {
			const response = await request.post("/", {
				data: { query: operation.query },
				headers: authorization ? { Authorization: authorization } : {},
				timeout: 2000,
				maxRetries: 0,
				maxRedirects: 0,
			});
			expect(response.status()).toBe(200);
			const body = await response.json();
			expect(body.data).toBeNull();
			expect(body.errors).toHaveLength(1);
			expect(body.errors[0].extensions.code).toBe("UNAUTHORIZED");
			expect(body.errors[0].path).toEqual([operation.field]);
		});
	}
}
