/**
 * Safe HTML excerpt with highlighted matches — a TypeScript port of the
 * native app's `SearchText.Snippet` (app/BibleOnSite/Helpers/SearchText.cs).
 *
 * Output contract: every input byte passes through HTML escaping; the only
 * markup emitted is <mark> around matched text. Safe to render via
 * dangerouslySetInnerHTML.
 */

import { htmlToPlainText, normalizeSearchText, searchTokens } from "./normalize";
import { tokenScore } from "./score";

const MARKS = /\p{Mn}/u;
const WORD_QUOTES = new Set(["'", '"', "׳", "״"]);
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

function escapeHtml(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function isInWordChar(char: string): boolean {
	return LETTER_OR_DIGIT.test(char) || MARKS.test(char) || WORD_QUOTES.has(char);
}

interface Match {
	start: number;
	end: number;
}

const CONTEXT_CHARS = 20;
const FALLBACK_CHARS = 50;

/**
 * Build a highlighted excerpt of `text` for `query`.
 * - `text` may contain HTML (perush notes, articles); it is stripped first.
 * - Literal phrase occurrences are marked, then words whose normalized form
 *   scores against any query term (prefix/fuzzy matches included).
 * - The window is anchored around the first match with a small context.
 */
export function searchSnippet(text: string, query: string): string {
	const plain = htmlToPlainText(text);
	const matches: Match[] = [];
	const terms = searchTokens(query);
	if (query.length > 0) {
		let offset = 0;
		const haystack = plain.toLowerCase();
		const needle = query.toLowerCase();
		for (;;) {
			const position = haystack.indexOf(needle, offset);
			if (position < 0) break;
			matches.push({ start: position, end: position + query.length });
			offset = position + query.length;
		}
	}
	let wordStart = -1;
	for (let i = 0; i <= plain.length; i++) {
		const inWord = i < plain.length && isInWordChar(plain[i]);
		if (inWord && wordStart < 0) {
			wordStart = i;
		}
		if (inWord || wordStart < 0) {
			continue;
		}
		const word = normalizeSearchText(plain.slice(wordStart, i));
		const covered = matches.some(
			(match) => match.start < i && match.end > wordStart,
		);
		if (!covered && terms.some((term) => tokenScore(word, term) > 0)) {
			matches.push({ start: wordStart, end: i });
		}
		wordStart = -1;
	}
	matches.sort((left, right) => left.start - right.start);
	const start = matches.length > 0 ? Math.max(0, matches[0].start - CONTEXT_CHARS) : 0;
	const end =
		matches.length > 0
			? Math.min(plain.length, matches[0].end + CONTEXT_CHARS)
			: Math.min(plain.length, FALLBACK_CHARS);
	let result = start > 0 ? "..." : "";
	let cursor = start;
	for (const match of matches) {
		if (match.start < start || match.end > end) continue;
		result += escapeHtml(plain.slice(cursor, match.start));
		result += `<mark>${escapeHtml(plain.slice(match.start, match.end))}</mark>`;
		cursor = match.end;
	}
	result += escapeHtml(plain.slice(cursor, end));
	if (end < plain.length) {
		result += "...";
	}
	return result;
}
