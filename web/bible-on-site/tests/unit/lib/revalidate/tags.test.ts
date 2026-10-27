/**
 * @jest-environment node
 *
 * cachedPerKey is what makes entity-scoped invalidation real: every
 * cached loader keys its unstable_cache entry on the entity and stamps it
 * with both the collection tag (operator escape hatch) and the
 * entity-scoped tags (surgical invalidation), never revalidating on a
 * timer.
 */
const mockUnstableCache = jest.fn(
	(fn: (...a: unknown[]) => unknown, _key: unknown, opts: unknown) => {
		const wrapped = (...a: unknown[]) => fn(...a);
		return Object.assign(wrapped, { opts });
	},
);
jest.mock("next/cache", () => ({
	unstable_cache: (
		fn: (...a: unknown[]) => unknown,
		key: unknown,
		opts: unknown,
	) => mockUnstableCache(fn, key, opts),
}));

import {
	articleTag,
	authorArticlesTag,
	authorTag,
	cachedPerKey,
	COLLECTION_TAGS,
	entityRefsTag,
	masoraArticlesTag,
	masoraPerushimTag,
	mentionRefsTag,
	parashaArticlesTag,
	parashaPerushimTag,
	perekArticlesTag,
	perekPerushimTag,
	perushDetailTag,
} from "../../../../src/lib/revalidate/tags";

describe("tag builders", () => {
	it("builds entity-scoped tags", () => {
		expect(articleTag(12)).toBe("article:12");
		expect(perekArticlesTag(5)).toBe("perek:5:articles");
		expect(perekPerushimTag(5)).toBe("perek:5:perushim");
		expect(perushDetailTag(7, 5)).toBe("perush:7:5");
		expect(authorTag("x")).toBe("author:x");
		expect(authorArticlesTag(3)).toBe("author:3:articles");
		expect(parashaArticlesTag(2, "torah")).toBe("parasha:2:torah:articles");
		expect(parashaPerushimTag(2, "haftara")).toBe(
			"parasha:2:haftara:perushim",
		);
		expect(masoraArticlesTag(1)).toBe("masora:1:articles");
		expect(masoraPerushimTag(1)).toBe("masora:1:perushim");
		expect(entityRefsTag(9)).toBe("perek:9:entity-refs");
		expect(mentionRefsTag(9)).toBe("perek:9:mention-refs");
	});

	it("keeps collection tags as the broad escape hatch", () => {
		expect(COLLECTION_TAGS.articles).toBe("articles");
		expect(COLLECTION_TAGS.authors).toBe("authors");
		expect(COLLECTION_TAGS.perushim).toBe("perushim");
		expect(COLLECTION_TAGS.pediaEntityRefs).toBe("tanahpedia-entity-refs");
		expect(COLLECTION_TAGS.pediaMentionRefs).toBe(
			"tanahpedia-mention-refs",
		);
		expect(COLLECTION_TAGS.perekImages).toBe("perek-images");
	});
});

describe("cachedPerKey", () => {
	beforeEach(() => jest.clearAllMocks());

	it("memoizes one unstable_cache entry per key with entity tags", async () => {
		const loader = jest.fn(async (id: number) => id * 2);
		const cached = cachedPerKey(
			"test-articles",
			(id: number) => String(id),
			(key) => [COLLECTION_TAGS.articles, perekArticlesTag(Number(key))],
			loader,
		);

		await cached(5);
		await cached(5);
		await cached(7);

		expect(mockUnstableCache).toHaveBeenCalledTimes(2);
		const [, keyA, optsA] = mockUnstableCache.mock.calls[0] as [
			unknown,
			string[],
			{ tags: string[]; revalidate: boolean },
		];
		const [, keyB, optsB] = mockUnstableCache.mock.calls[1] as [
			unknown,
			string[],
			{ tags: string[]; revalidate: boolean },
		];
		expect(keyA).toEqual(["test-articles", "5"]);
		expect(keyB).toEqual(["test-articles", "7"]);
		expect(optsA.tags).toEqual(["articles", "perek:5:articles"]);
		expect(optsB.tags).toEqual(["articles", "perek:7:articles"]);
		expect(optsA.revalidate).toBe(false);
		expect(loader).toHaveBeenCalledTimes(3);
	});

	it("passes the loader and its arguments through to unstable_cache", async () => {
		const loader = jest.fn();
		cachedPerKey(
			"test-two",
			(a: number, b: string) => `${a}:${b}`,
			(key) => [key],
			loader,
		)(3, "x");
		const [fn, keyParts] = mockUnstableCache.mock.calls[0] as [
			(...a: unknown[]) => unknown,
			string[],
			unknown,
		];
		await fn(3, "x");
		expect(loader).toHaveBeenCalledWith(3, "x");
		expect(keyParts).toEqual(["test-two", "3:x"]);
	});
});
