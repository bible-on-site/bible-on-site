import type { TargetCatalogue } from "./catalogue";
import {
	type AmbiguousCitation,
	extractCitations,
	type ResolvedCitation,
} from "./citations";

export type ArticleCitationCandidate =
	| (ResolvedCitation & { kind: "resolved"; sourceHash: string })
	| (AmbiguousCitation & { kind: "ambiguous"; sourceHash: string });

export interface ArticleCitationPageOptions {
	sourceHash: string;
	/** Absolute UTF-16 text page bounds, independent of candidate pagination. */
	cursor: number;
	limit: number;
	citationCursor?: number;
	citationLimit?: number;
}

/** The source remains evidence, not a restriction on semantic proposals.
 * Extract against the complete text so page boundaries cannot cut a citation.
 * Only overlapping candidates leave this function, with their original anchors. */
export function articleCitationPage(
	plainText: string,
	catalogue: TargetCatalogue,
	{
		sourceHash,
		cursor,
		limit,
		citationCursor = 0,
		citationLimit = 25,
	}: ArticleCitationPageOptions,
): {
	items: ArticleCitationCandidate[];
	total: number;
	nextCursor: number | null;
} {
	if (
		!/^[a-f0-9]{64}$/i.test(sourceHash) ||
		!Number.isSafeInteger(cursor) ||
		cursor < 0 ||
		!Number.isSafeInteger(limit) ||
		limit < 1 ||
		limit > 16000 ||
		!Number.isSafeInteger(citationCursor) ||
		citationCursor < 0 ||
		!Number.isSafeInteger(citationLimit) ||
		citationLimit < 1 ||
		citationLimit > 50
	)
		throw new Error("Invalid article citation page");
	const end = Math.min(plainText.length, cursor + limit);
	if (cursor >= end) return { items: [], total: 0, nextCursor: null };
	const extracted = extractCitations(plainText, catalogue);
	const candidates: ArticleCitationCandidate[] = [
		...extracted.resolved.map((citation) => ({
			...citation,
			kind: "resolved" as const,
			sourceHash,
		})),
		...extracted.ambiguous.map((citation) => ({
			...citation,
			kind: "ambiguous" as const,
			sourceHash,
		})),
	]
		.filter((citation) => citation.spanStart < end && citation.spanEnd > cursor)
		.sort(
			(a, b) =>
				a.spanStart - b.spanStart ||
				a.spanEnd - b.spanEnd ||
				a.kind.localeCompare(b.kind),
		);
	const items = candidates.slice(
		citationCursor,
		citationCursor + citationLimit,
	);
	const next = citationCursor + items.length;
	return {
		items,
		total: candidates.length,
		nextCursor: items.length > 0 && next < candidates.length ? next : null,
	};
}
