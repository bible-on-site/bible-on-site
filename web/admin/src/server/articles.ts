import { createServerFn } from "@tanstack/react-start";
import { execute, query, queryOne } from "./db";

export interface Article {
	id: number;
	perek_id: number;
	author_id: number;
	abstract: string | null;
	name: string;
	priority: number;
	content?: string | null;
	author_name?: string; // Populated when joined with authors table
}

export interface ArticleFormData {
	perek_id: number;
	author_id: number;
	abstract: string;
	name: string;
	priority: number;
	content: string;
}

// Get all articles (without content for performance)
export const getArticles = createServerFn({ method: "GET" }).handler(
	async () => {
		return await query<Omit<Article, "content">>(
			"SELECT id, perek_id, author_id, abstract, name, priority FROM tanah_article ORDER BY perek_id, priority",
		);
	},
);

// Get articles by perek
export const getArticlesByPerek = createServerFn({ method: "GET" })
	.inputValidator((data: number) => data)
	.handler(async ({ data: perekId }) => {
		const articles = await query<
			Omit<Article, "content"> & { author_name?: string }
		>(
			`SELECT a.id, a.perek_id, a.author_id, a.abstract, a.name, a.priority, au.name as author_name
			 FROM tanah_article a
			 LEFT JOIN tanah_author au ON a.author_id = au.id
			 WHERE a.perek_id = ? ORDER BY a.priority`,
			[perekId],
		);
		return articles;
	});

// Get article by ID (with content)
export const getArticle = createServerFn({ method: "GET" })
	.inputValidator((data: number) => data)
	.handler(async ({ data: id }) => {
		const article = await queryOne<Article>(
			"SELECT id, perek_id, author_id, abstract, name, priority, content FROM tanah_article WHERE id = ?",
			[id],
		);

		if (!article) {
			throw new Error("Article not found");
		}

		return article;
	});

// Create article
export const createArticle = createServerFn({ method: "POST" })
	.inputValidator((data: ArticleFormData) => data)
	.handler(async ({ data }) => {
		if (!data.name || !data.perek_id || !data.author_id) {
			throw new Error("Name, perek_id, and author_id are required");
		}

		const result = await execute(
			"INSERT INTO tanah_article (perek_id, author_id, abstract, name, priority, content) VALUES (?, ?, ?, ?, ?, ?)",
			[
				data.perek_id,
				data.author_id,
				data.abstract || null,
				data.name,
				data.priority || 1,
				data.content || null,
			],
		);

		const newArticle = await queryOne<Article>(
			"SELECT id, perek_id, author_id, abstract, name, priority, content FROM tanah_article WHERE id = ?",
			[result.insertId],
		);

		if (!newArticle) {
			throw new Error("Failed to retrieve created article");
		}
		return newArticle;
	});

// Update article
export const updateArticle = createServerFn({ method: "POST" })
	.inputValidator((data: { id: number } & ArticleFormData) => data)
	.handler(async ({ data }) => {
		if (!data.name || !data.perek_id || !data.author_id) {
			throw new Error("Name, perek_id, and author_id are required");
		}

		await execute(
			"UPDATE tanah_article SET perek_id = ?, author_id = ?, abstract = ?, name = ?, priority = ?, content = ? WHERE id = ?",
			[
				data.perek_id,
				data.author_id,
				data.abstract || null,
				data.name,
				data.priority || 1,
				data.content || null,
				data.id,
			],
		);

		const updated = await queryOne<Article>(
			"SELECT id, perek_id, author_id, abstract, name, priority, content FROM tanah_article WHERE id = ?",
			[data.id],
		);

		if (!updated) {
			throw new Error("Failed to retrieve updated article");
		}
		return updated;
	});

// Delete article
export const deleteArticle = createServerFn({ method: "POST" })
	.inputValidator((data: number) => data)
	.handler(async ({ data }) => {
		await execute("DELETE FROM tanah_article WHERE id = ?", [data]);
		return { success: true };
	});

// Cache invalidation - call CloudFront or your caching layer
export const invalidateArticleCache = createServerFn({ method: "POST" })
	.inputValidator((data: number) => data)
	.handler(async ({ data: articleId }) => {
		// TODO: Implement CloudFront invalidation when ready
		console.log(`Invalidating cache for article ${articleId}`);
		return { success: true };
	});

export const invalidatePerekCache = createServerFn({ method: "POST" })
	.inputValidator((data: number) => data)
	.handler(async ({ data: perekId }) => {
		// TODO: Implement CloudFront invalidation when ready
		console.log(`Invalidating cache for perek ${perekId}`);
		return { success: true };
	});
