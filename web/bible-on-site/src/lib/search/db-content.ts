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
 * exact-letter path, {@link termChunks chunking} adds a bare chunk
 * union to WHERE so a word within the scorer's edit-distance budget is
 * also selected (#2140) — the same typo tolerance the in-memory
 * corpora get by scoring everything.
 *
 * The scan runs in two stages with different cost profiles: WHERE
 * holds only the anchor-free chunk gate — the one pattern shape a
 * giant field can't make ICU backtrack on — under an inner
 * location-ordered LIMIT that early-terminates via an index for dense
 * terms; then ORDER BY runs the word-anchored rank estimate, but only
 * on `LEFT(field, RANK_TEXT_LIMIT)` and only on the bounded inner
 * set, so no single eval can exhaust `regexp_time_limit` and no
 * candidate pool can make the estimate unbounded. The estimate
 * mirrors the scorer's tiers (multi-term queries get a word-bounded
 * phrase flag first) before the row cap, so when a frequent term
 * overflows it, the truncated rows are the weakest candidates rather
 * than arbitrary early rows. The note table has no usable full-text
 * index today; the bounded ranked REGEXP keeps worst-case cost
 * predictable until a derived index (see the article-search
 * follow-up) covers commentary too.
 */

import { toLetters } from "gematry";
import { getPerekByPerekId } from "@/data/perek-dto";
import { queryText } from "@/lib/api-client";
// Import the pure slug helper directly — never the barrel: `authors/service`
// pulls `server-only` via reading-metrics, and Playwright e2e specs import
// this module under plain Node where that guard throws (#2607).
import { authorNameToSlug } from "@/lib/authors/url-utils";
import type { Scored } from "./corpus";
import { htmlToPlainText } from "./normalize";
import { maxEdits, prepareQuery, scorePreparedText } from "./score";

/**
 * Candidate rows pulled from MySQL before JS re-scoring. Bounded so a
 * query for a very common term can't transfer the whole table; the
 * ranked ORDER BY keeps the strongest candidates inside the bound.
 */
const CANDIDATE_LIMIT = 1000;

/**
 * Rows the pre-cap rank estimate may flag-evaluate. The estimate pays
 * one `REGEXP_LIKE` per rank pattern per field per row (see
 * {@link rankPredicates}), and a common-chunk term's gate can admit
 * tens of thousands of rows — flagging all of them costs far more than
 * the candidate scan itself. The WHERE therefore runs in a derived
 * table that keeps only the first rows under the provider's location
 * ordering (which rides an index, so the scan stops as soon as the
 * limit fills for dense terms). Rows beyond the bound are dropped
 * before the estimate runs — for terms whose candidate pool fits the
 * bound nothing is dropped at all, and for frequent terms the dropped
 * candidates are the latest-location ones, the same ordering the
 * final ORDER BY uses to break ties (#2140 follow-up).
 *
 * The bound scales with the estimate's flag count — bounded by
 * {@link RANK_EVAL_BUDGET} total evals so multi-term multi-field
 * queries don't blow the wall-clock budget on per-row flag evals —
 * and never below {@link MIN_INNER_LIMIT}, so even the widest
 * estimate still gets a useful candidate pool to rank.
 */
const RANK_EVAL_BUDGET = 6000;
const MIN_INNER_LIMIT = 300;
const MAX_INNER_LIMIT = 4000;

/**
 * Characters of each searchable field the pre-cap rank estimate sees.
 * Every rank pattern is word-anchored, so its cost grows with the text
 * it scans; a note can hold hundreds of KB (base64-embedded images
 * live in `note_content`), and an anchored pattern on an unbounded
 * blob can exhaust MySQL's per-match `regexp_time_limit` — which is a
 * hard query error, not a slow row. Capping the flag input bounds each
 * eval at ~`RANK_TEXT_LIMIT` positions, so no single row can sink the
 * statement. Ranking only reads the field's lead text — a deep
 * candidate still reaches JS scoring via the row itself; it just
 * ranks as if the match weren't there, which is the right bias for a
 * weak hit (#2140 follow-up).
 */
const RANK_TEXT_LIMIT = 2048;

/**
 * Bound a single statement's wall-clock time so a rare-term full scan
 * can't stall the request path. Requires MySQL 5.7.8+; ignored harmlessly
 * is worse than a hanging query, so it stays a literal hint. The fuzzy
 * candidate path scans an unindexed ~340k-row text column with a
 * normalization-aware `REGEXP_LIKE`, which legitimately costs a few
 * seconds on the perushim corpus — 3s was sized for the pre-#2140
 * bare-letters scan; 12s keeps a bound on runaway queries while letting
 * common-chunk terms finish, with headroom for multi-term queries that
 * pay the scan once per AND-ed term (#2140).
 */
const QUERY_TIME_BUDGET_MS = 12000;

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
 * Word-start-anchored pattern admitting every exact (90) and prefix
 * (80) word the JS scorer accepts: the term's letters in order from a
 * word start, with any length tail.
 */
function prefixRegexp(term: string): string {
	return `(?:^|${WORD_BOUNDARY})${IGNORABLE_RUN}*${lettersRegexp(term)}`;
}

/**
 * Whole-word pattern: the word equals the term modulo erased runs —
 * the scorer's 90 tier. Used only in the pre-cap rank estimate; the
 * candidate path covers exact words through {@link prefixRegexp}.
 */
function exactRegexp(term: string): string {
	return `(?:^|${WORD_BOUNDARY})${IGNORABLE_RUN}*${lettersRegexp(term)}${IGNORABLE_RUN}*(?:${WORD_BOUNDARY}|$)`;
}

/**
 * Typo-aware candidate alternands for one normalized term (#2140).
 *
 * The first piece keeps the exact/prefix path: the term's letters in
 * order from a word start, with any length tail — that admits every
 * exact (90) and prefix (80) word the JS scorer accepts.
 *
 * Each remaining piece matches a *word* containing one intact
 * {@link termChunks chunk}: `maxEdits` edits can corrupt at most that
 * many chunks, so every fuzzy-eligible word still holds an intact
 * chunk. A lookahead at the word start bounds the *whole* word's
 * letter count to the only lengths a bounded edit distance permits —
 * `[term - edits, term + edits]` (the distance can't shrink or grow a
 * word by more than `edits`). Bounding the total, rather than the
 * letters on each side of the chunk independently, keeps a chunk
 * sitting inside an over-long or too-short word out of the candidate
 * pool: those rows could only ever score zero.
 *
 * Cost discipline: every piece is a bounded quantifier — one bounded
 * lookahead and a bounded in-word prefix — never an unbounded `*`
 * over a nested ignorable run. An unbounded scan under a nested
 * quantifier makes ICU backtracking explode and trips MySQL's
 * `regexp_time_limit` on a full-table `WHERE` scan (#2140 follow-up).
 * The prefix bound `hi - chunk` is exact: a chunk starting further
 * into the word would leave the word longer than the window anyway.
 * Exported for unit tests.
 */
export function termAnchors(term: string): string[] {
	const edits = maxEdits(term);
	const anchors = [prefixRegexp(term)];
	if (edits === 0) {
		return anchors;
	}
	const length = [...term].length;
	const wordLengthBound = `(?=(?:${WORD_CHAR}${IGNORABLE_RUN}*){${
		length - edits
	},${length + edits}}(?:${WORD_BOUNDARY}|$))`;
	for (const chunk of termChunks(term)) {
		const inWordPrefix = `(?:${WORD_CHAR}${IGNORABLE_RUN}*){0,${
			length + edits - [...chunk].length
		}}`;
		anchors.push(
			`(?:^|${WORD_BOUNDARY})${IGNORABLE_RUN}*${wordLengthBound}${inWordPrefix}${lettersRegexp(chunk)}`,
		);
	}
	return [...new Set(anchors)];
}

/**
 * The strict fuzzy-candidate pattern for one normalized term: the OR of
 * its {@link termAnchors} — the exact/prefix shape plus one
 * length-windowed anchor per chunk. This is the pattern that
 * distinguishes a real fuzzy-eligible word (chunk inside a word of
 * `[term - edits, term + edits]` letters) from a chunk-bearing word
 * that can never score. WHERE does not run it — {@link termGateRegexp}
 * is the cheaper superset used there; this pattern runs only in the
 * pre-cap rank estimate, where its flag decides whether a matched row
 * holds a real candidate word (60) or only dead ones (0). Exported for
 * unit tests.
 */
export function termRegexp(term: string): string {
	const anchors = termAnchors(term);
	return anchors.length === 1 ? anchors[0] : `(?:${anchors.join("|")})`;
}

/**
 * The candidate-selection pattern WHERE applies per field: the union
 * of the term's {@link termChunks chunks} as bare ordered-letters
 * patterns, with no word anchoring — the same shape the pre-#2140
 * WHERE ran on every row.
 *
 * It is a true superset of every fuzzy-eligible row: a word the JS
 * scorer can rate holds at least one intact chunk, so the chunk's
 * letters appear in order in the field — the gate never drops a row
 * the scorer could accept, while mid-word chunk hits it over-admits
 * are cheap to shed later. Deliberately anchor-free: bare letter scans
 * are the cheapest `REGEXP_LIKE` shape there is, and the only shape
 * proven safe on the corpus's pathological rows — anything
 * word-anchored (`(?:^|boundary)…`) re-runs alternation work at every
 * position and can exhaust `regexp_time_limit` on a giant
 * `note_content` blob, which is a hard statement error. Anchored
 * patterns therefore run only in the rank estimate, where
 * `LEFT(field, RANK_TEXT_LIMIT)` bounds each eval (#2140 follow-up).
 * Exported for unit tests.
 */
export function termGateRegexp(term: string): string {
	const chunks = termChunks(term).map(lettersRegexp);
	return chunks.length === 1 ? chunks[0] : `(?:${chunks.join("|")})`;
}

/**
 * The word-level patterns the pre-cap rank instantiates per term, in
 * ascending match coverage: whole-word exact (scorer's 90 tier),
 * word-start prefix (80), then the full {@link termRegexp} candidate
 * union (adds the fuzzy chunk path — 60 at best). Since a word matching
 * an earlier pattern always matches the later ones, the weighted sum
 * `10*exact + 20*prefix + 60*candidate` lands on 90, 80, 60, or 0 —
 * the same values `tokenScore` assigns to a word. Exported for unit
 * tests.
 */
export function termRankPatterns(term: string): string[] {
	return [exactRegexp(term), prefixRegexp(term), termRegexp(term)];
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
 * boolean SQL expression containing exactly one `?` placeholder, bound
 * to the term's {@link termGateRegexp chunk union} — a bare
 * ordered-letters scan, the only pattern shape proven safe at any row
 * size, so the candidate scan can never hit `regexp_time_limit`
 * (#2140 follow-up). The gate is a true superset of the fuzzy-eligible
 * rows; shedding dead chunk hits is the rank estimate's job, not the
 * scan's.
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
		params: terms.flatMap((term) => {
			const gate = termGateRegexp(term);
			return predicates.map(() => gate);
		}),
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
 * then `LEAST` over the terms' word-level score estimates, mirroring
 * the scorer's minimum-term rule. A single-term query skips the phrase
 * flag: the estimate's exact flag is the same pattern, and the
 * estimate's 90 tier already sorts those rows first. Each term's estimate is
 * `10*exact + 20*prefix + 60*candidate` evaluated on a single
 * `REGEXP_LIKE` per {@link termRankPatterns pattern}: the patterns are
 * nested (exact ⇒ prefix ⇒ fuzzy-eligible), so the sum lands on 90,
 * 80, 60, or 0 — the tier `tokenScore` gives the term's best word in
 * that fragment. The `60*candidate` flag is the length-windowed
 * {@link termRegexp}: WHERE admits rows on the cheaper
 * {@link termGateRegexp} superset, so a chunk inside an over-long
 * word still reaches ORDER BY — but its flag is 0, which pushes the
 * row below every real candidate for the row cap to shed. Estimating
 * per *term* rather than per anchor keeps a
 * column whose words hit different chunks of the term separately —
 * `ירוש לימ` for a `ירושלימ` query — from outranking a real
 * fuzzy-eligible word the way a per-anchor flag count did (#2140
 * review). Each fragment is a boolean SQL expression containing one
 * `?` placeholder, bound to the phrase pattern for the flag and to
 * each rank pattern inside the estimate.
 */
function rankPredicates(
	predicates: string[],
	terms: string[],
): {
	orderBy: string;
	params: string[];
} {
	const phrase = phraseRegexp(terms);
	// For a single term the word-bounded phrase flag and the estimate's
	// exact flag are the same pattern — a one-term phrase is exactly a
	// whole word — and the estimate's 90 tier already sorts those rows
	// first, so a separate flag would pay a second identical
	// REGEXP_LIKE per matched row on the big table.
	const singleTerm = terms.length === 1;
	const estimate = (predicate: string) => {
		const estimates = terms.map(
			() => `(10*${predicate} + 20*${predicate} + 60*${predicate})`,
		);
		// LEAST takes two or more arguments — a single-term query emits
		// the bare estimate.
		return estimates.length === 1
			? estimates[0]
			: `LEAST(${estimates.join(", ")})`;
	};
	return {
		orderBy: predicates
			.flatMap((predicate) =>
				singleTerm
					? [`${estimate(predicate)} DESC`]
					: [`${predicate} DESC`, `${estimate(predicate)} DESC`],
			)
			.join(", "),
		params: predicates.flatMap(() =>
			singleTerm
				? terms.flatMap(termRankPatterns)
				: [phrase, ...terms.flatMap(termRankPatterns)],
		),
	};
}

/**
 * Pre-cap ranking over plain columns, field-by-field in weight order.
 * Every flag reads `LEFT(col, RANK_TEXT_LIMIT)` so a single anchored
 * eval is bounded no matter how large the stored field is — the
 * `regexp_time_limit` guard that makes the estimate safe on
 * pathological rows (#2140 follow-up).
 */
function rankClauses(
	columns: string[],
	terms: string[],
): {
	orderBy: string;
	params: string[];
} {
	return rankPredicates(
		columns.map(
			(col) => `REGEXP_LIKE(LEFT(${col}, ${RANK_TEXT_LIMIT}), ?, 'i')`,
		),
		terms,
	);
}

/**
 * Rows the rank estimate may flag-evaluate: `RANK_EVAL_BUDGET` spread
 * over the estimate's flag count (`fields × (1 + 3×terms)` — one
 * phrase flag plus the three {@link termRankPatterns} per term;
 * single-term queries skip the phrase flag), clamped to
 * `[MIN_INNER_LIMIT, MAX_INNER_LIMIT]`. The inner query's location
 * ordering rides an index, so a dense term stops scanning once the
 * limit fills; a sparse term scans the table anyway and keeps every
 * match.
 */
function innerCandidateLimit(fieldCount: number, termCount: number): number {
	const flagsPerRow = fieldCount * (termCount === 1 ? 3 : 1 + 3 * termCount);
	return Math.min(
		MAX_INNER_LIMIT,
		Math.max(MIN_INNER_LIMIT, Math.floor(RANK_EVAL_BUDGET / flagsPerRow)),
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
	const prepared = prepareQuery(phrase);
	const { terms } = prepared;
	if (terms.length === 0) return [];
	const { where, params } = matchClauses(["n.note_content"], terms);
	const rank = rankClauses(["n2.note_content"], terms);
	const rows = await queryText<{
		perush_id: number;
		perush_name: string;
		perek_id: number;
		pasuk: number;
		note_idx: number;
		note_content: string;
	}>(
		`SELECT /*+ MAX_EXECUTION_TIME(${QUERY_TIME_BUDGET_MS}) */
			n2.perush_id, p.name AS perush_name, n2.perek_id, n2.pasuk, n2.note_idx, n2.note_content
		 FROM (
			SELECT n.perush_id, n.perek_id, n.pasuk, n.note_idx, n.note_content
			  FROM note n
			 WHERE ${where}
			 ORDER BY n.perek_id, n.pasuk
			 LIMIT ${innerCandidateLimit(1, terms.length)}
		 ) n2
		 JOIN perush p ON n2.perush_id = p.id
		 ORDER BY ${rank.orderBy}, n2.perek_id, n2.pasuk
		 LIMIT ${CANDIDATE_LIMIT}`,
		[...params, ...rank.params],
	);

	const best = new Map<string, Scored<NoteHit>>();
	for (const row of rows) {
		const plain = htmlToPlainText(row.note_content);
		const score = scorePreparedText(plain, prepared);
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
	const prepared = prepareQuery(phrase);
	const { terms } = prepared;
	if (terms.length === 0) return [];
	const { where, params } = matchClauses(["name", "details"], terms);
	const rank = rankClauses(["a.name", "a.details"], terms);
	const rows = await queryText<{ id: number; name: string; details: string }>(
		`SELECT /*+ MAX_EXECUTION_TIME(${QUERY_TIME_BUDGET_MS}) */
			a.id, a.name, a.details
		 FROM (
			SELECT id, name, details
			  FROM tanah_author
			 WHERE ${where}
			 ORDER BY id
			 LIMIT ${innerCandidateLimit(2, terms.length)}
		 ) a
		 ORDER BY ${rank.orderBy}, a.id
		 LIMIT ${CANDIDATE_LIMIT}`,
		[...params, ...rank.params],
	);
	return rows
		.map((row) => {
			const details = htmlToPlainText(row.details ?? "");
			return {
				entry: {
					id: row.id,
					name: row.name,
					details,
					slug: authorNameToSlug(row.name),
				},
				score: Math.max(
					scorePreparedText(row.name, prepared) * 2,
					scorePreparedText(details, prepared),
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
	const prepared = prepareQuery(phrase);
	const { terms } = prepared;
	if (terms.length === 0) return [];
	const { where, params } = matchClauses(
		["a.name", "a.abstract", "a.content"],
		terms,
	);
	const rank = rankClauses(["a2.name", "a2.abstract", "a2.content"], terms);
	const rows = await queryText<{
		id: number;
		perek_id: number;
		name: string;
		author_name: string;
		content: string | null;
		abstract: string | null;
	}>(
		`SELECT /*+ MAX_EXECUTION_TIME(${QUERY_TIME_BUDGET_MS}) */
			a2.id, a2.perek_id, a2.name, au.name AS author_name, a2.content, a2.abstract
		 FROM (
			SELECT a.id, a.perek_id, a.author_id, a.name, a.abstract, a.content
			  FROM tanah_article a
			 WHERE a.perek_id BETWEEN 1 AND 929 AND ${where}
			 ORDER BY a.id
			 LIMIT ${innerCandidateLimit(3, terms.length)}
		 ) a2
		 JOIN tanah_author au ON a2.author_id = au.id
		 ORDER BY ${rank.orderBy}, a2.id
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
			const contentScore = scorePreparedText(contentPlain, prepared);
			const abstractScore = scorePreparedText(abstractPlain, prepared);
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
					scorePreparedText(row.name, prepared) * 2,
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
 * one. One `?` placeholder: the term/phrase regexp for `syn.name` —
 * WHERE binds it to the term's {@link termGateRegexp chunk union}, the
 * rank estimate to each {@link termRankPatterns} pattern in turn.
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
	const prepared = prepareQuery(phrase);
	const { terms } = prepared;
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
			`REGEXP_LIKE(LEFT(e.title, ${RANK_TEXT_LIMIT}), ?, 'i')`,
			`REGEXP_LIKE(LEFT(e.unique_name, ${RANK_TEXT_LIMIT}), ?, 'i')`,
			TANAHPEDIA_SYNONYM_MATCH,
			`REGEXP_LIKE(LEFT(e.content, ${RANK_TEXT_LIMIT}), ?, 'i')`,
		],
		terms,
	);
	const rows = await queryText<{
		id: string;
		unique_name: string;
		title: string;
		content: string | null;
	}>(
		`SELECT /*+ MAX_EXECUTION_TIME(${QUERY_TIME_BUDGET_MS}) */
			e.id, e.unique_name, e.title, e.content
		 FROM (
			SELECT e.id, e.unique_name, e.title, e.content
			  FROM tanahpedia_entry e
			 WHERE ${where}
			 ORDER BY e.id
			 LIMIT ${innerCandidateLimit(4, terms.length)}
		 ) e
		 ORDER BY ${rank.orderBy}, e.title, e.id
		 LIMIT ${CANDIDATE_LIMIT}`,
		[...params, ...rank.params],
	);
	if (rows.length === 0) return [];

	// Every name resolving to a candidate entry — its own aliases and the
	// disambiguation targets pointing at it — so scoring sees all of them.
	const ids = rows.map((row) => row.id);
	const placeholders = ids.map(() => "?").join(",");
	const synonymRows = await queryText<{ entryId: string; name: string }>(
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
				scorePreparedText(row.title, prepared),
				scorePreparedText(row.unique_name, prepared),
			);
			const synonymScore = synonyms.reduce(
				(best, name) => Math.max(best, scorePreparedText(name, prepared)),
				0,
			);
			const contentPlain = htmlToPlainText(row.content ?? "");
			const contentScore = scorePreparedText(contentPlain, prepared);
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
