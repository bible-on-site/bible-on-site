/**
 * Relevance scoring for Hebrew search — a TypeScript port of the native
 * app's `SearchText.Score` (app/BibleOnSite/Helpers/SearchText.cs).
 *
 * Score tiers:
 *   110 — the whole normalized text equals the normalized phrase
 *   100 — the phrase appears as a whole-word substring
 *   1–99 — every query term matches some word: exact 90, prefix 80,
 *          fuzzy (bounded edit distance) 60. The group's score is the
 *          minimum term score, so all terms must match.
 */

import { normalizeSearchText } from "./normalize";

/** Highest score for a single field: the entire normalized phrase matches. */
export const MAX_SEARCH_SCORE = 110;

/** Conservative typo tolerance: edits allowed per term length. */
export function maxEdits(term: string): number {
	if (term.length < 4) return 0;
	if (term.length < 8) return 1;
	return 2;
}

/**
 * Bounded Levenshtein distance; returns `limit + 1` once the bound is
 * provably exceeded so callers can bail early on long inputs.
 */
export function editDistance(
	left: string,
	right: string,
	limit: number,
): number {
	if (Math.abs(left.length - right.length) > limit) {
		return limit + 1;
	}
	if (limit === 1) {
		// Medium-length terms only need one edit. Scan the matching suffix
		// after the first mismatch without allocating a dynamic-programming
		// matrix for every word in the corpus. Keep UTF-16 comparisons, as
		// used by the general path and the native scorer.
		let i = 0;
		let j = 0;
		let edits = 0;
		while (i < left.length && j < right.length) {
			if (left[i] === right[j]) {
				i++;
				j++;
				continue;
			}
			if (edits === 1) return 2;
			edits++;
			if (left.length >= right.length) i++;
			if (right.length >= left.length) j++;
		}
		return edits + (i < left.length || j < right.length ? 1 : 0);
	}
	let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
	let current = new Array<number>(right.length + 1);
	for (let i = 1; i <= left.length; i++) {
		current[0] = i;
		for (let j = 1; j <= right.length; j++) {
			current[j] = Math.min(
				current[j - 1] + 1,
				previous[j] + 1,
				previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
			);
		}
		if (Math.min(...current) > limit) {
			return limit + 1;
		}
		[previous, current] = [current, previous];
	}
	return previous[right.length];
}

/** Score a single normalized word against a single normalized term. */
export function tokenScore(word: string, term: string): number {
	if (word === term) {
		return 90;
	}
	if (word.startsWith(term)) {
		return 80;
	}
	const edits = maxEdits(term);
	return edits > 0 && editDistance(word, term, edits) <= edits ? 60 : 0;
}

/** A query normalized once for a hot loop of candidates. */
export interface PreparedQuery {
	phrase: string;
	terms: string[];
}

/** Normalize `query` once so a loop of candidates never re-normalizes it. */
export function prepareQuery(query: string): PreparedQuery {
	const phrase = normalizeSearchText(query);
	return { phrase, terms: phrase.length === 0 ? [] : phrase.split(" ") };
}

/** Score raw `text` against a prepared query — normalizes the text only. */
export function scorePreparedText(
	text: string,
	prepared: PreparedQuery,
): number {
	const { phrase } = prepared;
	const occurrence = phrase.length > 0 ? text.indexOf(phrase) : -1;
	if (occurrence >= 0) {
		// ASCII spaces are preserved word boundaries under normalization.
		// Include an adjacent word on either side so this small context can
		// prove both a whole phrase hit and that the full text is not equal
		// to the phrase. No later text can improve that proven score of 100.
		const preceding = text.lastIndexOf(" ", occurrence - 1);
		const start = preceding > 0 ? text.lastIndexOf(" ", preceding - 1) + 1 : 0;
		const following = text.indexOf(" ", occurrence + phrase.length);
		const next = following < 0 ? -1 : text.indexOf(" ", following + 1);
		const end = next < 0 ? text.length : next;
		const context = normalizeSearchText(text.slice(start, end));
		if (start === 0 && end === text.length) {
			return scorePrepared(context, prepared);
		}
		if (context !== phrase && ` ${context} `.includes(` ${phrase} `)) {
			return 100;
		}
	}
	return scorePrepared(normalizeSearchText(text), prepared);
}

/** Score pre-normalized `normalized` text against a prepared query. */
export function scorePrepared(
	normalized: string,
	{ phrase, terms }: PreparedQuery,
): number {
	if (phrase.length === 0) {
		return 0;
	}
	if (normalized === phrase) {
		return MAX_SEARCH_SCORE;
	}
	if (` ${normalized} `.includes(` ${phrase} `)) {
		return 100;
	}
	const words = normalized.split(" ").filter((word) => word.length > 0);
	let minimum = 90;
	for (const term of terms) {
		// Find the strongest tier first. A prefix/exact match makes edit
		// distance work on every other word unnecessary; one fuzzy hit also
		// determines that tier once stronger matches have been excluded.
		let best = 0;
		if (words.includes(term)) best = 90;
		else if (words.some((word) => word.startsWith(term))) best = 80;
		else {
			const edits = maxEdits(term);
			if (
				edits > 0 &&
				words.some((word) => editDistance(word, term, edits) <= edits)
			) {
				best = 60;
			}
		}
		if (best === 0) return 0;
		minimum = Math.min(minimum, best);
	}
	return minimum;
}
