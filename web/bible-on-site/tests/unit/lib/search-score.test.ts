/**
 * @jest-environment node
 */
import {
	editDistance,
	maxEdits,
	searchScore,
	tokenScore,
} from "@/lib/search/score";

describe("maxEdits", () => {
	it("allows no edits for short terms, one for medium, two for long", () => {
		expect(maxEdits("אבג")).toBe(0);
		expect(maxEdits("אבגד")).toBe(1);
		expect(maxEdits("אבגדהוז")).toBe(1);
		expect(maxEdits("אבגדהוזח")).toBe(2);
	});
});

describe("editDistance", () => {
	it("returns the Levenshtein distance within the limit", () => {
		expect(editDistance("בראשית", "בראשית", 2)).toBe(0);
		expect(editDistance("בראשית", "בראשים", 1)).toBe(1);
	});

	it("bails out early with limit + 1 when the bound is exceeded", () => {
		expect(editDistance("א", "אבגדה", 2)).toBe(3);
		expect(editDistance("בראשית", "התיכשור", 1)).toBe(2);
	});
});

describe("tokenScore", () => {
	it("scores exact matches highest, then prefix, then fuzzy", () => {
		expect(tokenScore("בראשית", "בראשית")).toBe(90);
		expect(tokenScore("בראשית", "ברא")).toBe(80);
		expect(tokenScore("בראשית", "בראשים")).toBe(60);
	});

	it("rejects fuzzy matches for short terms", () => {
		expect(tokenScore("אתה", "אתא")).toBe(0);
	});

	it("returns zero for unrelated words", () => {
		expect(tokenScore("בראשית", "שלום")).toBe(0);
	});
});

describe("searchScore", () => {
	it("scores exact text-phrase equality at 110", () => {
		expect(searchScore("בראשית", "בְּרֵאשִׁית")).toBe(110);
	});

	it("scores a whole-word phrase containment at 100", () => {
		expect(searchScore("אל בריאת בראשית העולם", "בראשית")).toBe(100);
	});

	it("scores all-terms-present by the weakest term match", () => {
		// Terms are present but not adjacent, so the phrase tier does not apply.
		expect(searchScore("ברא אלהים בראשית", "בראשית ברא")).toBe(90);
		// A prefix-matched term pulls the group's minimum down to 80.
		expect(searchScore("ברא אלהים בראשיתו", "בראשית ברא")).toBe(80);
	});

	it("fails when any term is missing", () => {
		expect(searchScore("בראשית ברא אלהים", "בראשית שלום")).toBe(0);
	});

	it("ignores niqqud in both text and query", () => {
		expect(searchScore("בְּרֵאשִׁית בָּרָא", "בראשית ברא")).toBeGreaterThan(0);
	});

	it("returns zero for an empty query", () => {
		expect(searchScore("בראשית", "")).toBe(0);
	});
});
