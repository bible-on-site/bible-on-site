import { describe, expect, it } from "vitest";
import { buildHeuristicDrafts } from "~/lib/article-linking/heuristic";
import { catalogue, snapshot } from "./fixture";

describe("buildHeuristicDrafts", () => {
	it("produces pending coveringSources drafts with anchored evidence", () => {
		const { drafts, ambiguousQuotes } = buildHeuristicDrafts(
			"המאמר דן בבראשית יח, ב לעניין זה.",
			catalogue,
			snapshot,
		);
		expect(ambiguousQuotes).toEqual([]);
		expect(drafts).toHaveLength(1);
		expect(drafts[0].status).toBe("pending");
		expect(drafts[0].relationshipKey).toBe("coveringSources");
		expect(drafts[0].target).toEqual({
			pasukCoordinates: [{ perekId: 18, pasuk: 2 }],
		});
		expect(drafts[0].evidence[0].quote).toContain("בראשית");
	});

	it("holds a draft whose cited pesukim are already covered", () => {
		const { drafts } = buildHeuristicDrafts(
			"המאמר מתחיל בבראשית א, א.",
			catalogue,
			snapshot,
		);
		expect(drafts).toHaveLength(1);
		expect(drafts[0].status).toBe("held");
		expect(drafts[0].conflict).toContain("already in the covering set");
	});

	it("dedupes overlapping ranges inside one perek cluster", () => {
		const { drafts } = buildHeuristicDrafts(
			"ראה בראשית יח, א-ג ובראשית יח, ב.",
			catalogue,
			snapshot,
		);
		expect(drafts).toHaveLength(1);
		expect(drafts[0].target).toEqual({
			pasukCoordinates: [
				{ perekId: 18, pasuk: 1 },
				{ perekId: 18, pasuk: 2 },
				{ perekId: 18, pasuk: 3 },
			],
		});
	});

	it("surfaces ambiguous citations as held drafts and quotes", () => {
		const { drafts, ambiguousQuotes } = buildHeuristicDrafts(
			"כמו שכתוב שמואל ה, ז ידוע.",
			catalogue,
			snapshot,
		);
		expect(ambiguousQuotes).toHaveLength(1);
		const held = drafts.find((d) => d.status === "held");
		expect(held?.conflict).toBeTruthy();
		expect(held?.targetLabel).toBe("(לא נפתר)");
	});
});
