import { createHash } from "node:crypto";
import { unstable_cache } from "next/cache";
import { decorateArticleHtml } from "./decorate-article-html";
import {
	type ArticleMentionReference,
	getMentionReferencesForArticle,
} from "./service";

// Same invalidation story as perek mentions: the `tanahpedia-mention-refs`
// tag expires on every entry create/rename/delete, so resolved links flip
// on entry lifecycle events with zero re-inference. The content-hash key
// keeps edited articles out of stale decorations on top of that.
const getCachedArticleMentionRefs = unstable_cache(
	async (articleId: number, contentHash: string) =>
		getMentionReferencesForArticle(articleId, contentHash),
	["tanahpedia-mention-refs"],
	{
		tags: ["tanahpedia-mention-refs"],
		revalidate: false,
	},
);

/**
 * Resolved mention refs for an article's CURRENT stored content — the
 * sha256 must match the pipeline's `content_hash` exactly, so an edited
 * article yields no decorations instead of misplaced anchors.
 */
export async function fetchArticleMentionRefs(
	articleId: number,
	content: string,
): Promise<ArticleMentionReference[]> {
	const contentHash = createHash("sha256")
		.update(content, "utf8")
		.digest("hex");
	return getCachedArticleMentionRefs(articleId, contentHash);
}

/**
 * Article with its stored HTML content decorated by live-resolved mention
 * refs. Both article render paths (standalone page, flipbook view) go
 * through this so entry lifecycle events flip links identically. Content
 * stays raw in caches/metadata — decoration is applied per render.
 */
export async function decorateArticleContent<
	T extends { id: number; content: string | null },
>(article: T): Promise<T> {
	if (!article.content) return article;
	const refs = await fetchArticleMentionRefs(article.id, article.content);
	if (refs.length === 0) return article;
	return { ...article, content: decorateArticleHtml(article.content, refs) };
}
