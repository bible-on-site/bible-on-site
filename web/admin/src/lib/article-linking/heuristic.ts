/**
 * The deterministic/offline draft path (#3103): scripture citations the
 * extractor resolved become `coveringSources` add drafts; ambiguous
 * citations become held drafts so the reviewer sees them. No model call —
 * the same DraftProposal contract as the LLM path.
 */

import type { TargetCatalogue } from "./catalogue";
import { extractCitations } from "./citations";
import type { ArticleLinkSnapshot, DraftProposal } from "./types";

export interface HeuristicOutcome {
	drafts: DraftProposal[];
	/** Ambiguous citations surfaced for the reviewer (not proposals). */
	ambiguousQuotes: string[];
}

/** Groups citations by perek; a perek-level cluster is one add draft. */
export function buildHeuristicDrafts(
	plainText: string,
	catalogue: TargetCatalogue,
	snapshot: ArticleLinkSnapshot,
): HeuristicOutcome {
	const { resolved, ambiguous } = extractCitations(plainText, catalogue);
	const drafts: DraftProposal[] = [];
	const covered = new Set(
		snapshot.coveringSources.map((c) => `${c.perekId}:${c.pasuk}`),
	);

	// One draft per perek cluster keeps evidence spans together while a
	// single hallucinated pasuk never contaminates other perakim.
	const byPerek = new Map<number, typeof resolved>();
	for (const citation of resolved) {
		const list = byPerek.get(citation.perekId) ?? [];
		list.push(citation);
		byPerek.set(citation.perekId, list);
	}
	for (const citations of [...byPerek.values()].sort(
		(a, b) => a[0].perekId - b[0].perekId,
	)) {
		const seen = new Set<string>();
		const coordinates: { perekId: number; pasuk: number }[] = [];
		for (const c of citations) {
			for (let pasuk = c.pasuk; pasuk <= c.pasukTo; pasuk += 1) {
				const key = `${c.perekId}:${pasuk}`;
				if (!seen.has(key)) {
					seen.add(key);
					coordinates.push({ perekId: c.perekId, pasuk });
				}
			}
		}
		const novel = coordinates.filter(
			(c) => !covered.has(`${c.perekId}:${c.pasuk}`),
		);
		const label = citations[0].label.replace(/ [א-ת]+(-[א-ת]+)?$/, "");
		if (novel.length === 0) {
			drafts.push({
				relationshipKey: "coveringSources",
				action: "add",
				target: { pasukCoordinates: coordinates },
				targetLabel: label,
				evidence: citations.map((c) => ({
					quote: c.quote,
					spanStart: c.spanStart,
					spanEnd: c.spanEnd,
				})),
				rationale: null,
				confidence: null,
				conflict: "every cited pasuk is already in the covering set",
				status: "held",
			});
			continue;
		}
		drafts.push({
			relationshipKey: "coveringSources",
			action: "add",
			target: { pasukCoordinates: novel },
			targetLabel: label,
			evidence: citations.map((c) => ({
				quote: c.quote,
				spanStart: c.spanStart,
				spanEnd: c.spanEnd,
			})),
			rationale: "citation(s) extracted from the article text",
			confidence: null,
			conflict: null,
			status: "pending",
		});
	}

	for (const item of ambiguous) {
		drafts.push({
			relationshipKey: "coveringSources",
			action: "add",
			target: { pasukCoordinates: [] },
			targetLabel: "(לא נפתר)",
			evidence: [
				{ quote: item.quote, spanStart: item.spanStart, spanEnd: item.spanEnd },
			],
			rationale: null,
			confidence: null,
			conflict: item.reason,
			status: "held",
		});
	}
	return {
		drafts,
		ambiguousQuotes: ambiguous.map((a) => a.quote),
	};
}
