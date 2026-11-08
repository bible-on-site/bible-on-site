import { createHash } from "node:crypto";
import {
	decorateArticleContent,
	fetchArticleMentionRefs,
} from "@/lib/tanahpedia/article-mention-refs";
import {
	type ArticleMentionReference,
	getMentionReferencesForArticle,
} from "@/lib/tanahpedia/service";

jest.mock("next/cache", () => ({
	unstable_cache: (loader: (...args: never[]) => unknown) => loader,
}));

jest.mock("@/lib/tanahpedia/service", () => ({
	getMentionReferencesForArticle: jest.fn(),
}));

const loadRefs = jest.mocked(getMentionReferencesForArticle);

beforeEach(() => loadRefs.mockReset());

describe("fetchArticleMentionRefs", () => {
	it("resolves decorations keyed to the article's exact content hash", async () => {
		const content = "<p>אברם אבינו</p>";
		loadRefs.mockResolvedValueOnce([]);
		await fetchArticleMentionRefs(42, content);
		const expectedHash = createHash("sha256")
			.update(content, "utf8")
			.digest("hex");
		expect(loadRefs).toHaveBeenCalledWith(42, expectedHash);
	});

	it("different content hashes miss stale decoration rows", async () => {
		loadRefs.mockResolvedValue([]);
		await fetchArticleMentionRefs(1, "<p>v1</p>");
		await fetchArticleMentionRefs(1, "<p>v2</p>");
		const hashes = loadRefs.mock.calls.map((c) => c[1]);
		expect(hashes[0]).not.toEqual(hashes[1]);
	});
});

describe("decorateArticleContent", () => {
	const article = {
		id: 7,
		perekId: 1,
		authorId: 1,
		abstract: null,
		name: "מאמר",
		priority: 1,
		authorName: "רב",
		authorImageUrl: "https://x/y.png",
	};

	it("returns the article untouched when it has no content", async () => {
		const bare = { ...article, content: null };
		expect(await decorateArticleContent(bare)).toBe(bare);
		expect(loadRefs).not.toHaveBeenCalled();
	});

	it("returns the article untouched when nothing resolves", async () => {
		loadRefs.mockResolvedValueOnce([]);
		const withContent = { ...article, content: "<p>אברם</p>" };
		expect(await decorateArticleContent(withContent)).toBe(withContent);
	});

	it("decorates content with resolved mention anchors", async () => {
		const content = "<p>אמר אל אברם</p>";
		const start = content.indexOf("אברם");
		const ref: ArticleMentionReference = {
			entryUniqueName: "אברם-אבינו",
			spanStart: start,
			spanEnd: start + 4,
			surface: "אברם",
		};
		loadRefs.mockResolvedValueOnce([ref]);
		const decorated = await decorateArticleContent({ ...article, content });
		expect(decorated.content).toContain('class="tanahpedia-mention"');
		expect(decorated.content).toContain(
			`href="/pedia/${encodeURIComponent("אברם-אבינו")}"`,
		);
		expect(decorated.id).toBe(7);
	});
});
