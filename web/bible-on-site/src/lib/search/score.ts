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
export function editDistance(left: string, right: string, limit: number): number {
	if (Math.abs(left.length - right.length) > limit) {
		return limit + 1;
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

/**
 * Score `text` against `query`. Both are normalized inside; call
 * `scoreNormalizedText` when the candidate text is already normalized
 * (hot loops over a pre-indexed corpus).
 */
export function searchScore(text: string, query: string): number {
	return scoreNormalizedText(normalizeSearchText(text), query);
}

/** Score pre-normalized `normalized` text against `query`. */
export function scoreNormalizedText(
	normalized: string,
	query: string,
): number {
	const phrase = normalizeSearchText(query);
	if (phrase.length === 0) {
		return 0;
	}
	if (normalized === phrase) {
		return 110;
	}
	if (` ${normalized} `.includes(` ${phrase} `)) {
		return 100;
	}
	const words = normalized.split(" ").filter((word) => word.length > 0);
	const scores = phrase
		.split(" ")
		.filter((term) => term.length > 0)
		.map((term) =>
			words
				.map((word) => tokenScore(word, term))
				.reduce((best, score) => Math.max(best, score), 0),
		);
	return scores.every((score) => score > 0)
		? scores.reduce((min, score) => Math.min(min, score))
		: 0;
}
