/**
 * MySQL-backed search providers for content that lives in the database:
 * perush notes, authors, and articles.
 *
 * Candidates are selected with bounded `REGEXP_LIKE` patterns — AND-ed
 * across terms, ranked, capped, MAX_EXECUTION_TIME — then normalized
 * and scored in JS with the same algorithm used for pesukim. Each
 * term's letters may be separated in stored text by anything the JS
 * pipeline erases (niqqud/taamim combining marks, quote chars such as
 * gershayim, HTML tags, entities), so `שליטא` still reaches a stored
 * `שליט"א`, which `LIKE '%שליטא%'` could never select. Candidates are
 * ordered by a word-bounded phrase pattern before the row cap, so when
 * a frequent term overflows it, the truncated rows are the weakest
 * substring-only candidates rather than arbitrary early rows. The note
 * table has no usable full-text index today; the bounded ranked REGEXP
 * keeps worst-case cost predictable until a derived index (see the
 * article-search follow-up) covers commentary too.
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
 * query for a very common term can't transfer the whole table; the
 * ranked ORDER BY keeps the strongest candidates inside the bound.
 */
const CANDIDATE_LIMIT = 1000;

/**
 * Bound a single statement's wall-clock time so a rare-term full scan
 * can't stall the request path. Requires MySQL 5.7.8+; ignored harmlessly
 * is worse than a hanging query, so it stays a literal hint.
 */
const QUERY_TIME_BUDGET_MS = 3000;

/**
 * Regex fragment matching raw-storage characters the JS pipeline
 * (`htmlToPlainText` + `normalizeSearchText`) erases without leaving a
 * word boundary: combining marks (niqqud/taamim), quote-like characters
 * (geresh, gershayim, typographic quotes), HTML tags, and entities.
 */
const IGNORABLE_RUN = String.raw`(?:\p{M}|["'׳״‘’“”]|<[^>]+>|&[a-zA-Z#0-9]+;)`;

/**
 * Regex fragment matching what separates two words in raw storage: any
 * non-letter/non-digit run (spaces and punctuation collapse to word
 * boundaries when normalized) plus tags and entities, whose delimiters
 * are non-letters but which contain literal letters.
 */
const WORD_BOUNDARY = String.raw`(?:[^\p{L}\p{N}]|<[^>]+>|&[a-zA-Z#0-9]+;)`;

/**
 * Candidate-selection pattern for one normalized term: its letters in
 * order, allowing ignorable runs between them. Exported for unit tests.
 */
export function termRegexp(term: string): string {
	return [...term].join(`${IGNORABLE_RUN}*`);
}

/**
 * Word-level pattern for the whole normalized phrase: the terms as
 * consecutive words, bounded by word breaks (or string edges) on both
 * ends. Rows matching it are the candidates the JS scorer rates
 * highest — whole-word phrase containment or whole-text equality — so
 * it also serves as the DB-side rank applied before the row cap.
 * Exported for unit tests.
 */
export function phraseRegexp(terms: string[]): string {
	const body = terms.map(termRegexp).join(`${WORD_BOUNDARY}+`);
	return `(?:^|${WORD_BOUNDARY})${body}(?:${WORD_BOUNDARY}|$)`;
}

/**
 * Per-term candidate predicate: every term must match at least one of
 * the columns (AND across terms, OR across columns).
 */
function matchClauses(
	columns: string[],
	terms: string[],
): {
	where: string;
	params: string[];
} {
	return {
		where: terms
			.map(
				() =>
					`(${columns.map((col) => `REGEXP_LIKE(${col}, ?, 'i')`).join(" OR ")})`,
			)
			.join(" AND "),
		params: terms.flatMap((term) => columns.map(() => termRegexp(term))),
	};
}

/**
 * Candidate ranking applied before the row cap: word-bounded phrase
 * matches first, field-by-field in descending weight order, so an
 * overflowing candidate pool sheds substring-only rows first.
 */
function rankClauses(
	columns: string[],
	terms: string[],
): {
	orderBy: string;
	params: string[];
} {
	const phrase = phraseRegexp(terms);
	return {
		orderBy: columns
			.map((col) => `REGEXP_LIKE(${col}, ?, 'i') DESC`)
			.join(", "),
		params: columns.map(() => phrase),
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
	const { where, params } = matchClauses(["n.note_content"], terms);
	const rank = rankClauses(["n.note_content"], terms);
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
		 ORDER BY ${rank.orderBy}, n.perek_id, n.pasuk
		 LIMIT ${CANDIDATE_LIMIT}`,
		[...params, ...rank.params],
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
	const { where, params } = matchClauses(["name", "details"], terms);
	const rank = rankClauses(["name", "details"], terms);
	const rows = await query<{ id: number; name: string; details: string }>(
		`SELECT /*+ MAX_EXECUTION_TIME(${QUERY_TIME_BUDGET_MS}) */
			id, name, details
		 FROM tanah_author
		 WHERE ${where}
		 ORDER BY ${rank.orderBy}, id
		 LIMIT ${CANDIDATE_LIMIT}`,
		[...params, ...rank.params],
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
	const { where, params } = matchClauses(
		["a.name", "a.abstract", "a.content"],
		terms,
	);
	const rank = rankClauses(["a.name", "a.abstract", "a.content"], terms);
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
		 WHERE ${where}
		 ORDER BY ${rank.orderBy}, a.id
		 LIMIT ${CANDIDATE_LIMIT}`,
		[...params, ...rank.params],
	);
	return rows
		.map((row) => {
			// Name, abstract, and content are each scored on their own: the
			// SQL candidate may have matched only the abstract, so falling
			// back to content alone would score a real match as zero.
			const contentPlain = htmlToPlainText(row.content ?? "");
			const abstractPlain = htmlToPlainText(row.abstract ?? "");
			const contentScore = searchScore(contentPlain, phrase);
			const abstractScore = searchScore(abstractPlain, phrase);
			return {
				entry: {
					id: row.id,
					perekId: row.perek_id,
					name: row.name,
					authorName: row.author_name,
					// Snippet text comes from the best-matching body field, so
					// an abstract-only hit surfaces its abstract.
					plain:
						abstractScore > contentScore
							? abstractPlain
							: contentPlain || abstractPlain,
				},
				score: Math.max(
					searchScore(row.name, phrase) * 2,
					contentScore,
					abstractScore,
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
