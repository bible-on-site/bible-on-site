"use server";

import type { Article } from "@/lib/articles";
import { getArticleById } from "@/lib/articles";

/**
 * Fetch a single article by ID for in-book display (e.g. flipbook blank page).
 * Returns null if not found.
 */
export async function getArticleForBook(
	articleId: number,
): Promise<Article | null> {
	return getArticleById(articleId);
}
