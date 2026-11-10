import { afterEach, describe, expect, it, vi } from "vitest";
import {
	articleApiConfigured,
	fetchArticleRelationships,
	updateArticleRelationships,
} from "~/server/article-relationships-api";

const KEY = "ARTICLE_API_KEY";
const URL = "ARTICLE_API_URL";

afterEach(() => {
	vi.unstubAllGlobals();
	delete process.env[KEY];
	delete process.env[URL];
});

const relationships = {
	perekId: 1,
	authorId: 2,
	coverageVerified: true,
	contentHash: "h",
	coveringSources: [{ perekId: 1, pasuk: 1 }],
};

function stubFetch(body: unknown, init: { ok?: boolean; status?: number; text?: string } = {}) {
	const res = {
		ok: init.ok ?? true,
		status: init.status ?? 200,
		text: async () => init.text ?? "",
		json: async () => body,
	};
	const fetchMock = vi.fn().mockResolvedValue(res);
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

describe("articleApiConfigured", () => {
	it("reflects the key's presence", () => {
		expect(articleApiConfigured()).toBe(false);
		process.env[KEY] = " key ";
		expect(articleApiConfigured()).toBe(true);
	});
});

describe("fetchArticleRelationships", () => {
	it("throws when ARTICLE_API_KEY is missing", async () => {
		await expect(fetchArticleRelationships(7)).rejects.toThrow(
			/ARTICLE_API_KEY/,
		);
	});

	it("posts to the configured base and returns the relationship state", async () => {
		process.env[KEY] = "k";
		process.env[URL] = "https://api.test/";
		const fetchMock = stubFetch({
			data: { articleRelationships: relationships },
		});
		const out = await fetchArticleRelationships(7);
		expect(out).toEqual(relationships);
		const [url, init] = fetchMock.mock.calls[0] as [
			string,
			{ body: string; headers: Record<string, string> },
		];
		expect(url).toBe("https://api.test");
		expect(init.headers.Authorization).toBe("Bearer k");
		expect(JSON.parse(init.body).variables).toEqual({ articleId: 7 });
	});

	it("returns null for an unknown article", async () => {
		process.env[KEY] = "k";
		stubFetch({ data: { articleRelationships: null } });
		expect(await fetchArticleRelationships(999)).toBeNull();
	});

	it("throws on an HTTP failure", async () => {
		process.env[KEY] = "k";
		stubFetch({}, { ok: false, status: 502, text: "bad gateway" });
		await expect(fetchArticleRelationships(7)).rejects.toThrow(/HTTP 502/);
	});

	it("throws on a GraphQL error payload", async () => {
		process.env[KEY] = "k";
		stubFetch({ errors: [{ message: "denied" }] });
		await expect(fetchArticleRelationships(7)).rejects.toThrow(/denied/);
	});

	it("throws when data is absent without errors", async () => {
		process.env[KEY] = "k";
		stubFetch({});
		await expect(fetchArticleRelationships(7)).rejects.toThrow(/no data/);
	});
});

describe("updateArticleRelationships", () => {
	it("sends the mutation and returns relationships, previous and revalidation", async () => {
		process.env[KEY] = "k";
		const update = {
			revalidation: "APPLIED",
			relationships,
			previous: { ...relationships, coveringSources: [] },
		};
		const fetchMock = stubFetch({ data: { updateArticleRelationships: update } });
		const input = {
			source: "link-proposal-1:editor",
			perekId: 18,
			expectedContentHash: "h",
		};
		const out = await updateArticleRelationships(7, input);
		expect(out).toEqual(update);
		const sent = JSON.parse(
			(fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
		);
		expect(sent.query).toContain("updateArticleRelationships");
		expect(sent.variables).toEqual({ articleId: 7, input });
	});
});
