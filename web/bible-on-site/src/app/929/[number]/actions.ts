"use server";

import type { Article } from "@/lib/articles";
import { getArticleById } from "@/lib/articles";
import type { PerushNote } from "@/lib/perushim";
import { getPerushNotes } from "@/lib/perushim";

/**
 * Fetch a single article by ID for in-book display (e.g. flipbook blank page).
 * Returns null if not found.
 */
export async function getArticleForBook(
	articleId: number,
): Promise<Article | null> {
	return getArticleById(articleId);
}

/**
 * Fetch perush notes for a specific perush on a specific perek (server action).
 */
export async function getPerushNotesForPage(
	perushId: number,
	perekId: number,
): Promise<PerushNote[]> {
	return getPerushNotes(perushId, perekId);
}
