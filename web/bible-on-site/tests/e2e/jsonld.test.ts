import { expect, test } from "@playwright/test";

/**
 * E2E: assert that JSON-LD structured data is server-rendered as valid
 * `application/ld+json` on the key routes, and that every block parses and
 * carries the expected schema.org node types. The shared Organization +
 * WebSite graph is injected by the root layout, so sub-pages carry it too.
 */

const LD_JSON_RE =
	/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;

function extractJsonLd(html: string): unknown[] {
	const blocks: unknown[] = [];
	LD_JSON_RE.lastIndex = 0;
	let match = LD_JSON_RE.exec(html);
	while (match !== null) {
		blocks.push(JSON.parse(match[1]));
		match = LD_JSON_RE.exec(html);
	}
	return blocks;
}

function graphTypes(blocks: unknown[]): Set<string> {
	const types = new Set<string>();
	for (const block of blocks) {
		const graph = (block as { "@graph"?: unknown[] })["@graph"] ?? [block];
		for (const node of graph as Array<{ "@type"?: string }>) {
			if (typeof node["@type"] === "string") {
				types.add(node["@type"]);
			}
		}
	}
	return types;
}

async function typesForRoute(
	request: import("@playwright/test").APIRequestContext,
	path: string,
): Promise<{ blocks: unknown[]; types: Set<string> }> {
	// `next dev` compiles a route on its first request, which can exceed the
	// default request timeout for the heaviest pages; give it room.
	const response = await request.get(path, { timeout: 120000 });
	expect(response.status()).toBe(200);
	const blocks = extractJsonLd(await response.text());
	expect(blocks.length).toBeGreaterThan(0);
	for (const block of blocks) {
		expect(block).toHaveProperty("@context", "https://schema.org");
	}
	return { blocks, types: graphTypes(blocks) };
}

test.describe("JSON-LD structured data", () => {
	// The first request to each route triggers a `next dev` compile; triple the
	// per-test timeout so a cold heavy route (e.g. /929/1) does not flake.
	test.beforeEach(() => {
		test.slow();
	});

	test("root page emits a valid Organization + WebSite graph", async ({
		request,
	}) => {
		const { types } = await typesForRoute(request, "/");
		expect(types.has("Organization")).toBe(true);
		expect(types.has("WebSite")).toBe(true);
	});

	test("perek page emits a Chapter graph plus the shared site graph", async ({
		request,
	}) => {
		const { types } = await typesForRoute(request, "/929/1");
		expect(types.has("Chapter")).toBe(true);
		expect(types.has("BreadcrumbList")).toBe(true);
		expect(types.has("WebSite")).toBe(true);
	});

	test("tanahpedia landing emits a DefinedTermSet CollectionPage", async ({
		request,
	}) => {
		const { types } = await typesForRoute(request, "/pedia");
		expect(types.has("DefinedTermSet")).toBe(true);
		expect(types.has("CollectionPage")).toBe(true);
	});

	test("authors list emits a CollectionPage + ItemList", async ({
		request,
	}) => {
		const { types } = await typesForRoute(request, "/929/authors");
		expect(types.has("CollectionPage")).toBe(true);
		expect(types.has("ItemList")).toBe(true);
	});
});
