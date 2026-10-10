import {
	type APIRequestContext,
	type APIResponse,
	expect,
	test,
} from "@playwright/test";

const ROOT_URL = "http://127.0.0.1:3003";

interface SearchHit {
	articleId: number;
	name: string;
	authorName: string;
	perekId: number;
	source: string;
	excerpt: string;
	score: number;
}

const SEARCH_QUERY = `query SearchArticles($phrase: String!, $limit: Int, $offset: Int) {
  searchArticles(phrase: $phrase, limit: $limit, offset: $offset) {
    total
    hits { articleId name authorName perekId source excerpt score }
  }
}`;

async function gql(
	request: APIRequestContext,
	query: string,
	variables: Record<string, unknown> = {},
): Promise<APIResponse> {
	return request.post(ROOT_URL, {
		headers: { "Content-Type": "application/json" },
		data: { operationName: null, variables, query },
	});
}

async function search(
	request: APIRequestContext,
	phrase: string,
	variables: Record<string, unknown> = {},
): Promise<{ total: number; hits: SearchHit[] } | undefined> {
	const response = await gql(request, SEARCH_QUERY, { phrase, ...variables });
	const body = await response.json();
	return body.data?.searchArticles;
}

/** Waits for the boot-time index build (populated test articles) to land. */
async function waitForIndex(request: APIRequestContext): Promise<void> {
	await expect
		.poll(async () => (await search(request, "בראשית"))?.total ?? 0, {
			timeout: 30000,
			intervals: [500, 1000, 2000],
		})
		.toBeGreaterThan(0);
}

test.describe("ArticleSearch", () => {
	test("returns relevant public articles with excerpts and scores", async ({
		request,
	}) => {
		await waitForIndex(request);
		const page = await search(request, "בראשית ברא");
		expect(page).toBeDefined();
		expect(page!.hits.length).toBeGreaterThan(0);
		const hit = page!.hits[0];
		expect(hit.articleId).toBeGreaterThan(0);
		expect(hit.perekId).toBe(1);
		expect(hit.name.length).toBeGreaterThan(0);
		expect(hit.score).toBeGreaterThan(0);
		expect(hit.excerpt.length).toBeGreaterThan(0);
		// Excerpts are plain text — no HTML markup leaks through.
		expect(hit.excerpt).not.toMatch(/<[^>]+>/);
	});

	test("scores are sorted descending and stable", async ({ request }) => {
		await waitForIndex(request);
		const page = await search(request, "בראשית");
		expect(page!.hits.length).toBeGreaterThan(1);
		const scores = page!.hits.map((h) => h.score);
		expect([...scores].sort((a, b) => b - a)).toEqual(scores);
	});

	test("respects limit and offset pagination", async ({ request }) => {
		await waitForIndex(request);
		const full = await search(request, "בראשית");
		const limited = await search(request, "בראשית", { limit: 1 });
		expect(limited!.hits.length).toBe(1);
		expect(limited!.total).toBe(full!.total);
		const second = await search(request, "בראשית", { limit: 1, offset: 1 });
		expect(second!.hits[0]?.articleId).not.toBe(limited!.hits[0]?.articleId);
	});

	test("never returns non-distributable articles", async ({ request }) => {
		// The seeded non-distributable article is the only row containing the
		// marker "רזאדשבתא" — a matching query must return nothing for it.
		await waitForIndex(request);
		const page = await search(request, "רזאדשבתא");
		expect(page).toBeDefined();
		expect(page!.total).toBe(0);
		expect(page!.hits).toEqual([]);
	});

	test("normalizes final Hebrew letters on the query side", async ({
		request,
	}) => {
		await waitForIndex(request);
		// "שמים" (final mem) vs query "שמימ" (regular mem) must still match.
		const plain = await search(request, "שמים");
		const swappedFinals = await search(request, "שמימ");
		expect(plain!.total).toBeGreaterThan(0);
		expect(swappedFinals!.total).toBe(plain!.total);
		// Niqqud on the query side must be stripped.
		const niqqud = await search(request, "בְּרֵאשִׁית");
		expect(niqqud!.total).toBeGreaterThan(0);
	});

	test("returns empty page for unmatched phrases", async ({ request }) => {
		const page = await search(request, "קקקקקקקקק");
		expect(page).toBeDefined();
		expect(page!.total).toBe(0);
		expect(page!.hits).toEqual([]);
	});

	test("rejects invalid arguments", async ({ request }) => {
		for (const variables of [
			{ phrase: "x", limit: 0 },
			{ phrase: "x", limit: 51 },
			{ phrase: "x", offset: -1 },
			{ phrase: "x", offset: 1001 },
		]) {
			const response = await gql(request, SEARCH_QUERY, variables);
			const body = await response.json();
			expect(body.errors).toBeDefined();
			expect(body.errors[0].extensions?.code).toBe("BAD_REQUEST");
		}
		const response = await gql(request, SEARCH_QUERY, {
			phrase: "א".repeat(300),
		});
		const body = await response.json();
		expect(body.errors).toBeDefined();
	});
});
