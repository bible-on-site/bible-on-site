import "@tanstack/react-start/server-only";
import type mysql from "mysql2/promise";
import { isCoveringSourceSchemaMissing } from "./covering-sources";
import { query, txExecute, txQuery } from "./db";

/**
 * Server-only article↔moed link helpers (#3101) split out of moadim.ts.
 *
 * A module a route or component can import ships only its `createServerFn`
 * stubs to the client — plain exported functions survive verbatim, and any
 * that touch `./db` drag mysql2 into the browser bundle and crash at
 * module init. DB helpers therefore live behind the server-only boundary
 * here; moadim.ts keeps the createServerFn surface + pure helpers only.
 */

/** Distinguishes "schema not deployed" from a real failure (same predicate
 * as the covering-source convention — missing table/column). */
export function isMoedSchemaMissing(error: unknown): boolean {
	return isCoveringSourceSchemaMissing(error);
}

/** The moed ids explicitly linked to an article — undefined when the moed
 * schema is not deployed (never "the article links to nothing"). */
export async function loadArticleMoedIds(
	articleId: number,
): Promise<number[] | undefined> {
	try {
		const rows = await query<{ moed_id: number }>(
			"SELECT moed_id FROM tanah_article_moed WHERE article_id = ? ORDER BY moed_id",
			[articleId],
		);
		return (rows ?? []).map((row) => row.moed_id);
	} catch (error) {
		if (!isMoedSchemaMissing(error)) throw error;
		return undefined;
	}
}

/**
 * Replaces the article's moed link set inside a save transaction. Returns
 * the (id, slug) pairs of every affected moed (old ∪ new) for the
 * post-commit invalidation; `null` when nothing changed.
 */
export async function txReplaceArticleMoadim(
	conn: mysql.PoolConnection,
	articleId: number,
	moedIds: number[],
): Promise<{ id: number; slug: string }[] | null> {
	const unique = [...new Set(moedIds)];
	if (unique.length !== moedIds.length) {
		throw new Error("moedIds: מועד כפול");
	}
	if (unique.length > 0) {
		const placeholders = unique.map(() => "?").join(",");
		const existing = await txQuery<{ id: number }>(
			conn,
			`SELECT id FROM tanah_moed WHERE id IN (${placeholders})`,
			unique,
		);
		const existingIds = new Set(existing.map((row) => row.id));
		for (const id of unique) {
			if (!existingIds.has(id)) throw new Error(`מועד ${id} לא קיים`);
		}
	}
	const current = await txMoedArticleLinks(conn, articleId);
	const currentIds = new Set(current.map((link) => link.id));
	const wanted = new Set(unique);
	const toAdd = unique.filter((id) => !currentIds.has(id));
	const toRemove = [...currentIds].filter((id) => !wanted.has(id));
	if (toAdd.length === 0 && toRemove.length === 0) return null;
	if (toRemove.length > 0) {
		await txExecute(
			conn,
			`DELETE FROM tanah_article_moed WHERE article_id = ? AND moed_id IN (${toRemove.map(() => "?").join(",")})`,
			[articleId, ...toRemove],
		);
	}
	for (const moedId of toAdd) {
		await txExecute(
			conn,
			"INSERT INTO tanah_article_moed (article_id, moed_id) VALUES (?, ?)",
			[articleId, moedId],
		);
	}
	// old ∪ new — every touched moed page expires.
	const affected = new Map<number, { id: number; slug: string }>();
	for (const link of current) {
		if (!wanted.has(link.id)) affected.set(link.id, link);
	}
	if (toAdd.length > 0) {
		const placeholders = toAdd.map(() => "?").join(",");
		const rows = await txQuery<{ id: number; slug: string }>(
			conn,
			`SELECT id, slug FROM tanah_moed WHERE id IN (${placeholders})`,
			toAdd,
		);
		for (const row of rows) affected.set(row.id, row);
	}
	return [...affected.values()];
}

/** Loads the article's moed links with slugs inside a txn. */
async function txMoedArticleLinks(
	conn: mysql.PoolConnection,
	articleId: number,
): Promise<{ id: number; slug: string }[]> {
	return txQuery<{ id: number; slug: string }>(
		conn,
		`SELECT m.id, m.slug FROM tanah_article_moed am
		 JOIN tanah_moed m ON m.id = am.moed_id
		 WHERE am.article_id = ? ORDER BY m.id`,
		[articleId],
	);
}
