/**
 * MySQL-backed search providers for content that lives in the database:
 * perush notes, authors, articles, and Tanahpedia entries.
 *
 * Candidates are selected with bounded `REGEXP_LIKE` patterns — AND-ed
 * across terms, ranked, capped, MAX_EXECUTION_TIME — then normalized
 * and scored in JS with the same algorithm used for pesukim. Each
 * term's letters may be separated in stored text by anything the JS
 * pipeline erases (niqqud/taamim combining marks, quote chars such as
 * gershayim, HTML tags, entities), so `שליטא` still reaches a stored
 * `שליט"א`, which `LIKE '%שליטא%'` could never select. Beyond the
 * exact-letter path, `termAnchors` adds bounded chunk patterns so a
 * word within the scorer's edit-distance budget is also selected
 * (#2140) — the same typo tolerance the in-memory corpora get by
 * scoring everything. Candidates are ordered by a word-bounded phrase
 * pattern, then by how many of each term's anchors matched, before the
 * row cap, so when a frequent term overflows it, the truncated rows
 * are the weakest candidates rather than arbitrary early rows. The
 * note table has no usable full-text index today; the bounded ranked
 * REGEXP keeps worst-case cost predictable until a derived index (see
 * the article-search follow-up) covers commentary too.
 */

import { toLetters } from "gematry";
import { getPerekByPerekId } from "@/data/perek-dto";
import { query } from "@/lib/api-client";
import { authorNameToSlug } from "@/lib/authors";
import type { Scored } from "./corpus";
import { htmlToPlainText, searchTokens } from "./normalize";
import { maxEdits, searchScore } from "./score";

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
 * Regex fragment matching one letter or digit in raw storage — what a
 * normalized word is made of. Counted repetitions of it bound a word's
 * normalized length inside the typo-tolerant chunk patterns below.
 */
const WORD_CHAR = String.raw`[\p{L}\p{N}]`;

/**
 * A fragment's letters in order, allowing ignorable runs between them —
 * the shape every candidate alternand is built from.
 */
function lettersRegexp(fragment: string): string {
	return [...fragment].join(`${IGNORABLE_RUN}*`);
}

/**
 * Split a normalized term into `maxEdits(term) + 1` contiguous chunks as
 * equal in length as possible. Each edit (substitution, insertion,
 * deletion) corrupts at most one chunk, so every word within the JS
 * scorer's bounded edit distance keeps at least one chunk intact and
 * contiguous — the classic pigeonhole filter that makes the chunk
 * patterns below a superset of the fuzzy-eligible rows. Exported for
 * unit tests.
 */
export function termChunks(term: string): string[] {
	const count = maxEdits(term) + 1;
	const chars = [...term];
	const base = Math.floor(chars.length / count);
	const chunks: string[] = [];
	let offset = 0;
	for (let i = 0; i < count; i++) {
		const width = base + (i < chars.length % count ? 1 : 0);
		chunks.push(chars.slice(offset, offset + width).join(""));
		offset += width;
	}
	return chunks;
}

/**
 * Typo-aware candidate alternands for one normalized term (#2140).
 *
 * The first piece keeps the exact/prefix path: the term's letters in
 * order from a word start, with any length tail — that admits every
 * exact (90) and prefix (80) word the JS scorer accepts.
 *
 * Each remaining piece bounds a *word* containing one intact
 * {@link termChunks chunk}: `maxEdits` edits can corrupt at most that
 * many chunks, so every fuzzy-eligible word still holds an intact chunk
 * and is at most `term + maxEdits` letters long. The counted
 * `{0,budget}` rooms on both sides of the chunk reject chunks sitting
 * inside longer words, which could never reach the fuzzy tier — that
 * keeps short chunks selective instead of flooding the candidate pool.
 * Exported for unit tests.
 */
export function termAnchors(term: string): string[] {
	const edits = maxEdits(term);
	const anchors = [
		`(?:^|${WORD_BOUNDARY})${IGNORABLE_RUN}*${lettersRegexp(term)}`,
	];
	if (edits === 0) {
		return anchors;
	}
	const room = (budget: number) =>
		`(?:${WORD_CHAR}${IGNORABLE_RUN}*){0,${budget}}`;
	const length = [...term].length;
	for (const chunk of termChunks(term)) {
		const budget = length + edits - [...chunk].length;
		anchors.push(
			`(?:^|${WORD_BOUNDARY})${IGNORABLE_RUN}*${room(budget)}${lettersRegexp(chunk)}${IGNORABLE_RUN}*${room(budget)}${IGNORABLE_RUN}*(?:${WORD_BOUNDARY}|$)`,
		);
	}
	return [...new Set(anchors)];
}

/**
 * Candidate-selection pattern for one normalized term: the OR of its
 * {@link termAnchors}, so a row is selectable by the exact/prefix shape
 * or by any word that survived the scorer's edit-distance bound.
 * Exported for unit tests.
 */
export function termRegexp(term: string): string {
	const anchors = termAnchors(term);
	return anchors.length === 1 ? anchors[0] : `(?:${anchors.join("|")})`;
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
	const body = terms.map(lettersRegexp).join(`${WORD_BOUNDARY}+`);
	return `(?:^|${WORD_BOUNDARY})${body}(?:${WORD_BOUNDARY}|$)`;
}

/**
 * Per-term candidate predicate: every term must match at least one of the
 * fragments (AND across terms, OR across fragments). Each fragment is a
 * boolean SQL expression containing exactly one `?` placeholder bound to
 * the term's regexp pattern — a `REGEXP_LIKE(col, ?, 'i')` or a compound
 * expression built around one (e.g. the Tanahpedia synonym subquery).
 */
function matchPredicates(
	predicates: string[],
	terms: string[],
): {
	where: string;
	params: string[];
} {
	return {
		where: terms.map(() => `(${predicates.join(" OR ")})`).join(" AND "),
		params: terms.flatMap((term) => predicates.map(() => termRegexp(term))),
	};
}

/** Per-term candidate predicate over plain columns (OR across columns). */
function matchClauses(
	columns: string[],
	terms: string[],
): {
	where: string;
	params: string[];
} {
	return matchPredicates(
		columns.map((col) => `REGEXP_LIKE(${col}, ?, 'i')`),
		terms,
	);
}

/**
 * Candidate ranking applied before the row cap, fragment-by-fragment in
 * descending weight order with two tiers per fragment: a word-bounded
 * exact-phrase flag — the candidate class the JS scorer rates highest —
 * then the count of each term's {@link termAnchors} pieces matched, so
 * rows carrying a fuzzy-eligible word (several chunk anchors hit
 * together) outrank rows where only a stray chunk matched. Each
 * fragment is a boolean SQL expression containing one `?` placeholder,
 * bound to the phrase pattern for the flag and to each anchor pattern
 * inside its count.
 */
function rankPredicates(
	predicates: string[],
	terms: string[],
): {
	orderBy: string;
	params: string[];
} {
	const phrase = phraseRegexp(terms);
	const flags = terms.flatMap(termAnchors);
	return {
		orderBy: predicates
			.flatMap((predicate) => [
				`${predicate} DESC`,
				`(${flags.map(() => predicate).join(" + ")}) DESC`,
			])
			.join(", "),
		params: predicates.flatMap(() => [phrase, ...flags]),
	};
}

/** Pre-cap ranking over plain columns, field-by-field in weight order. */
function rankClauses(
	columns: string[],
	terms: string[],
): {
	orderBy: string;
	params: string[];
} {
	return rankPredicates(
		columns.map((col) => `REGEXP_LIKE(${col}, ?, 'i')`),
		terms,
	);
}

export interface NoteHit {
	perushId: number;
	perushName: string;
	perekId: number;
	pasukNum: number;
	/**
	 * The note row's index within the pasuk — carried into the result link so
	 * the perush page can target this exact fragment, not the pasuk's first
	 * note (#2078).
	 */
	noteIdx: number;
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
		note_idx: number;
		note_content: string;
	}>(
		`SELECT /*+ MAX_EXECUTION_TIME(${QUERY_TIME_BUDGET_MS}) */
			n.perush_id, p.name AS perush_name, n.perek_id, n.pasuk, n.note_idx, n.note_content
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
				noteIdx: row.note_idx,
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
		.sort(
			(left, right) =>
				right.score - left.score || left.entry.id - right.entry.id,
		)
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
		 WHERE a.perek_id BETWEEN 1 AND 929 AND ${where}
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

export interface TanahpediaHit {
	id: string;
	uniqueName: string;
	title: string;
	/**
	 * Plain text the result snippet is built from: the entry body for a
	 * content match, the entry's alias names when an alias drove the match,
	 * or the body lead-in for a title-only match. "" when the entry has
	 * neither body nor aliases (title matches alone still surface the hit).
	 */
	plain: string;
}

/**
 * Candidate fragment matching an entry reachable through a synonym name —
 * directly (`syn.entry_id`) or as a disambiguation target
 * (`dis.entry_id`), mirroring the `/pedia/[slug]` resolution rules so an
 * ambiguous name surfaces every target entry instead of silently picking
 * one. One `?` placeholder: the term/phrase regexp for `syn.name`.
 */
const TANAHPEDIA_SYNONYM_MATCH = `EXISTS (
		SELECT 1
		  FROM tanahpedia_entry_synonym syn
		  LEFT JOIN tanahpedia_entry_synonym_disambiguation dis
		    ON dis.synonym_id = syn.id
		 WHERE (syn.entry_id = e.id OR dis.entry_id = e.id)
		   AND REGEXP_LIKE(syn.name, ?, 'i'))`;

/**
 * Lexical Tanahpedia entry search over title, unique_name, synonym names,
 * and body content. Every `tanahpedia_entry` row is public (proposals
 * stay in `tanahpedia_entry_revision` until applied), so the full table
 * is in scope. One hit per entry — an entry matched through several
 * aliases is still a single result.
 */
export async function searchTanahpediaEntries(
	phrase: string,
	limit: number,
): Promise<Scored<TanahpediaHit>[]> {
	const terms = searchTokens(phrase);
	if (terms.length === 0) return [];
	const { where, params } = matchPredicates(
		[
			"REGEXP_LIKE(e.title, ?, 'i')",
			"REGEXP_LIKE(e.unique_name, ?, 'i')",
			"REGEXP_LIKE(e.content, ?, 'i')",
			TANAHPEDIA_SYNONYM_MATCH,
		],
		terms,
	);
	const rank = rankPredicates(
		[
			"REGEXP_LIKE(e.title, ?, 'i')",
			"REGEXP_LIKE(e.unique_name, ?, 'i')",
			TANAHPEDIA_SYNONYM_MATCH,
			"REGEXP_LIKE(e.content, ?, 'i')",
		],
		terms,
	);
	const rows = await query<{
		id: string;
		unique_name: string;
		title: string;
		content: string | null;
	}>(
		`SELECT /*+ MAX_EXECUTION_TIME(${QUERY_TIME_BUDGET_MS}) */
			e.id, e.unique_name, e.title, e.content
		 FROM tanahpedia_entry e
		 WHERE ${where}
		 ORDER BY ${rank.orderBy}, e.title, e.id
		 LIMIT ${CANDIDATE_LIMIT}`,
		[...params, ...rank.params],
	);
	if (rows.length === 0) return [];

	// Every name resolving to a candidate entry — its own aliases and the
	// disambiguation targets pointing at it — so scoring sees all of them.
	const ids = rows.map((row) => row.id);
	const placeholders = ids.map(() => "?").join(",");
	const synonymRows = await query<{ entryId: string; name: string }>(
		`SELECT syn.entry_id AS entryId, syn.name AS name
		   FROM tanahpedia_entry_synonym syn
		  WHERE syn.entry_id IN (${placeholders})
		  UNION
		 SELECT dis.entry_id AS entryId, syn.name AS name
		   FROM tanahpedia_entry_synonym_disambiguation dis
		   JOIN tanahpedia_entry_synonym syn ON syn.id = dis.synonym_id
		  WHERE dis.entry_id IN (${placeholders})`,
		[...ids, ...ids],
	);
	const synonymsByEntry = new Map<string, string[]>();
	for (const row of synonymRows) {
		const names = synonymsByEntry.get(row.entryId);
		if (names) {
			names.push(row.name);
		} else {
			synonymsByEntry.set(row.entryId, [row.name]);
		}
	}

	return rows
		.map((row) => {
			const synonyms = synonymsByEntry.get(row.id) ?? [];
			const titleScore = Math.max(
				searchScore(row.title, phrase),
				searchScore(row.unique_name, phrase),
			);
			const synonymScore = synonyms.reduce(
				(best, name) => Math.max(best, searchScore(name, phrase)),
				0,
			);
			const contentPlain = htmlToPlainText(row.content ?? "");
			const contentScore = searchScore(contentPlain, phrase);
			return {
				entry: {
					id: row.id,
					uniqueName: row.unique_name,
					title: row.title,
					// The snippet explains the match: highlighted body text when
					// content scored, the alias list when an alias outscored the
					// title, else the body lead-in ("" when the entry is empty).
					plain:
						contentScore > 0
							? contentPlain
							: synonymScore > titleScore
								? `נקרא גם: ${synonyms.join(", ")}`
								: contentPlain,
				},
				// Title and aliases are the name fields (x2 like author/article
				// names); body content is the weak signal.
				score: Math.max(Math.max(titleScore, synonymScore) * 2, contentScore),
			};
		})
		.filter((hit) => hit.score > 0)
		.sort(
			(left, right) =>
				right.score - left.score ||
				left.entry.title.localeCompare(right.entry.title, "he") ||
				left.entry.id.localeCompare(right.entry.id),
		)
		.slice(0, limit);
}
