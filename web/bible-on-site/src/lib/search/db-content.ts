/**
 * MySQL-backed search providers for content that lives in the database:
 * perush notes, authors, and articles.
 *
 * Notes are searched with bounded `LIKE '%term%'` candidate selection
 * (AND-ed across terms, capped rows, MAX_EXECUTION_TIME) and then
 * normalized/scored in JS with the same algorithm used for pesukim —
 * MySQL LIKE has no awareness of niqqud or fuzzy matches. The note table
 * has no usable full-text index today; the bounded LIKE keeps worst-case
 * cost predictable until a derived index (see the article-search follow-up)
 * covers commentary too.
 */

import { toLetters } from "gematry";
import { getPerekByPerekId } from "@/data/perek-dto";
import { query } from "@/lib/api-client";
import { authorNameToSlug } from "@/lib/authors";
import { htmlToPlainText, searchTokens } from "./normalize";
import { searchScore } from "./score";
import type { Scored } from "./corpus";

/**
 * Candidate rows pulled from MySQL before JS re-scoring. Bounded so a
 * query for a very common term can't transfer the whole table.
 */
const CANDIDATE_LIMIT = 250;

/**
 * Bound a single statement's wall-clock time so a rare-term full scan
 * can't stall the request path. Requires MySQL 5.7.8+; ignored harmlessly
 * is worse than a hanging query, so it stays a literal hint.
 */
const QUERY_TIME_BUDGET_MS = 3000;

function likeClauses(terms: string[]): {
	where: string;
	params: string[];
} {
	return {
		where: terms.map(() => "note_content LIKE ?").join(" AND "),
		params: terms.map((term) => `%${term}%`),
	};
}

export interface NoteHit {
	perushId: number;
	perushName: string;
	perekId: number;
	pasukNum: number;
	noteContent: string;
	plain: string;
}

/**
 * Search commentary notes. Returns at most one hit per
 * (perush, perek, pasuk) — the highest-scoring note_idx fragment —
 * so a multi-fragment note doesn't crowd the result list.
 */
export async function searchPerushNotes(
	phrase: string,
	limit: number,
): Promise<Scored<NoteHit>[]> {
	const terms = searchTokens(phrase);
	if (terms.length === 0) return [];
	const { where, params } = likeClauses(terms);
	const rows = await query<{
		perush_id: number;
		perush_name: string;
		perek_id: number;
		pasuk: number;
		note_content: string;
	}>(
		`SELECT /*+ MAX_EXECUTION_TIME(${QUERY_TIME_BUDGET_MS}) */
			n.perush_id, p.name AS perush_name, n.perek_id, n.pasuk, n.note_content
		 FROM note n
		 JOIN perush p ON n.perush_id = p.id
		 WHERE ${where}
		 LIMIT ${CANDIDATE_LIMIT}`,
		params,
	);

	const best = new Map<string, Scored<NoteHit>>();
	for (const row of rows) {
		const plain = htmlToPlainText(row.note_content);
		const score = searchScore(plain, phrase);
		if (score === 0) continue;
		const key = `${row.perush_id}:${row.perek_id}:${row.pasuk}`;
		const hit: Scored<NoteHit> = {
			score,
			entry: {
				perushId: row.perush_id,
				perushName: row.perush_name,
				perekId: row.perek_id,
				pasukNum: row.pasuk,
				noteContent: row.note_content,
				plain,
			},
		};
		const existing = best.get(key);
		if (!existing || hit.score > existing.score) {
			best.set(key, hit);
		}
	}
	return [...best.values()]
		.sort(
			(left, right) =>
				right.score - left.score ||
				left.entry.perekId - right.entry.perekId ||
				left.entry.pasukNum - right.entry.pasukNum,
		)
		.slice(0, limit);
}

/** Display reference for a perush hit, e.g. "רש"י בראשית א א". */
export function perushHitReference(hit: NoteHit): string {
	const { source } = getPerekByPerekId(hit.perekId);
	return `${hit.perushName} ${source} ${toLetters(hit.pasukNum)}`;
}

export interface AuthorHit {
	id: number;
	name: string;
	details: string;
	slug: string;
}

export async function searchAuthors(
	phrase: string,
	limit: number,
): Promise<Scored<AuthorHit>[]> {
	const terms = searchTokens(phrase);
	if (terms.length === 0) return [];
	const rows = await query<{ id: number; name: string; details: string }>(
		`SELECT /*+ MAX_EXECUTION_TIME(${QUERY_TIME_BUDGET_MS}) */
			id, name, details
		 FROM tanah_author
		 WHERE ${terms.map(() => "(name LIKE ? OR details LIKE ?)").join(" AND ")}
		 LIMIT ${CANDIDATE_LIMIT}`,
		terms.flatMap((term) => [`%${term}%`, `%${term}%`]),
	);
	return rows
		.map((row) => ({
			entry: {
				id: row.id,
				name: row.name,
				details: htmlToPlainText(row.details ?? ""),
				slug: authorNameToSlug(row.name),
			},
			score: Math.max(
				searchScore(row.name, phrase) * 2,
				searchScore(htmlToPlainText(row.details ?? ""), phrase),
			),
		}))
		.filter((hit) => hit.score > 0)
		.sort((left, right) => right.score - left.score || left.entry.id - right.entry.id)
		.slice(0, limit);
}

export interface ArticleHit {
	id: number;
	perekId: number;
	name: string;
	authorName: string;
	plain: string;
}

/**
 * Lexical article search over name, abstract, and content.
 *
 * #2039 integration seam: when the shared Rust semantic-search API lands,
 * a remote provider implementing this same signature (phrase + limit in,
 * scored article hits out) should replace/augment this provider — see
 * docs/website/search.md for the expected request/response contract.
 * Keep `searchArticles` as the only call site so the swap touches one file.
 */
export async function searchArticles(
	phrase: string,
	limit: number,
): Promise<Scored<ArticleHit>[]> {
	const terms = searchTokens(phrase);
	if (terms.length === 0) return [];
	const rows = await query<{
		id: number;
		perek_id: number;
		name: string;
		author_name: string;
		content: string | null;
		abstract: string | null;
	}>(
		`SELECT /*+ MAX_EXECUTION_TIME(${QUERY_TIME_BUDGET_MS}) */
			a.id, a.perek_id, a.name, au.name AS author_name, a.content, a.abstract
		 FROM tanah_article a
		 JOIN tanah_author au ON a.author_id = au.id
		 WHERE ${terms.map(() => "(a.name LIKE ? OR a.abstract LIKE ? OR a.content LIKE ?)").join(" AND ")}
		 LIMIT ${CANDIDATE_LIMIT}`,
		terms.flatMap((term) => [`%${term}%`, `%${term}%`, `%${term}%`]),
	);
	return rows
		.map((row) => {
			const plain = htmlToPlainText(row.content ?? row.abstract ?? "");
			return {
				entry: {
					id: row.id,
					perekId: row.perek_id,
					name: row.name,
					authorName: row.author_name,
					plain,
				},
				score: Math.max(
					searchScore(row.name, phrase) * 2,
					searchScore(plain, phrase),
				),
			};
		})
		.filter((hit) => hit.score > 0)
		.sort(
			(left, right) =>
				right.score - left.score || left.entry.id - right.entry.id,
		)
		.slice(0, limit);
}
