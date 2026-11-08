import { describe, expect, it } from "vitest";
import {
	citationEvidence,
	extractCitations,
} from "~/lib/article-linking/citations";
import { catalogue } from "./fixture";

describe("extractCitations", () => {
	describe("with comma-form citations", () => {
		it("resolves a plain sefer citation", () => {
			const { resolved, ambiguous } = extractCitations(
				"כדברי בראשית יח, ב המאמר דן.",
				catalogue,
			);
			expect(ambiguous).toHaveLength(0);
			expect(resolved).toHaveLength(1);
			expect(resolved[0].perekId).toBe(18);
			expect(resolved[0].pasuk).toBe(2);
			expect(resolved[0].pasukTo).toBe(2);
			expect(resolved[0].quote).toBe("בראשית יח, ב");
		});

		it("resolves a citation with an additional letter", () => {
			const { resolved } = extractCitations(
				"ראה שמואל ב ה, ז לעניין זה.",
				catalogue,
			);
			expect(resolved).toHaveLength(1);
			expect(resolved[0].perekId).toBe(605);
			expect(resolved[0].pasuk).toBe(7);
		});

		it("resolves a pasuk range", () => {
			const { resolved } = extractCitations(
				"הטקסט בראשית יח, ב-ה מראה.",
				catalogue,
			);
			expect(resolved).toHaveLength(1);
			expect(resolved[0].pasuk).toBe(2);
			expect(resolved[0].pasukTo).toBe(5);
		});

		it("resolves aliased sefer names", () => {
			const tehillim = extractCitations("תהלים קיט, א.", catalogue);
			expect(tehillim.resolved[0].perekId).toBe(730);
			const ezra = extractCitations("עזרא ז, ב.", catalogue);
			expect(ezra.resolved[0].perekId).toBe(800);
			const nehemiah = extractCitations("נחמיה ג, ד.", catalogue);
			expect(nehemiah.resolved[0].perekId).toBe(810);
		});
	});

	describe("with the bare space-separated form", () => {
		it("resolves plain sefer citations", () => {
			const { resolved } = extractCitations("יהושע כג א", {
				perakim: [
					{
						id: 900,
						seferName: "יהושע",
						additionalLetter: null,
						perekInContext: 23,
						pasukCount: 16,
					},
				],
				authors: [],
				dedications: [],
			});
			expect(resolved).toHaveLength(1);
			expect(resolved[0].perekId).toBe(900);
			expect(resolved[0].pasuk).toBe(1);
		});

		it("resolves additional-letter citations", () => {
			const { resolved } = extractCitations("כמו שמואל ב ה ז כתוב.", catalogue);
			expect(resolved).toHaveLength(1);
			expect(resolved[0].perekId).toBe(605);
			expect(resolved[0].pasuk).toBe(7);
		});

		it("holds additional sefarim whose letter is missing", () => {
			const { resolved, ambiguous } = extractCitations(
				"שמואל ה ז נאמר.",
				catalogue,
			);
			expect(resolved).toHaveLength(0);
			expect(ambiguous).toHaveLength(1);
			expect(ambiguous[0].quote).toBe("שמואל ה ז");
		});
	});

	describe("with explicit perek/pasuk keywords", () => {
		it("resolves the פרק/פסוק phrasing", () => {
			const { resolved } = extractCitations(
				"בראשית פרק יח פסוק ב מתאר.",
				catalogue,
			);
			expect(resolved).toHaveLength(1);
			expect(resolved[0].perekId).toBe(18);
			expect(resolved[0].pasuk).toBe(2);
		});
	});

	describe("with ambiguous or invalid input", () => {
		it("holds comma-form citations missing the additional letter", () => {
			const { ambiguous } = extractCitations("שמואל ה, ז.", catalogue);
			expect(ambiguous).toHaveLength(1);
		});

		it("holds citations whose pasuk exceeds the canonical bound", () => {
			const { resolved, ambiguous } = extractCitations(
				"בראשית א, צ כתוב.",
				catalogue,
			);
			expect(resolved).toHaveLength(0);
			expect(ambiguous).toHaveLength(1);
			expect(ambiguous[0].reason).toContain("out of range");
		});

		it("ignores sefer names followed by ordinary prose words", () => {
			const { resolved, ambiguous } = extractCitations(
				"בראשית ברא אלוקים את השמים ואת הארץ.",
				catalogue,
			);
			expect(resolved).toHaveLength(0);
			expect(ambiguous).toHaveLength(0);
		});

		it("keeps the matched quote and offsets for evidence", () => {
			const text = "פתיחה. בראשית יח, ב ועוד.";
			const { resolved } = extractCitations(text, catalogue);
			expect(text.slice(resolved[0].spanStart, resolved[0].spanEnd)).toBe(
				resolved[0].quote,
			);
		});

		it("drops citations to perakim absent from the catalogue", () => {
			const { resolved, ambiguous } = extractCitations(
				"תהילים קכ, א מוזכר.",
				catalogue,
			);
			expect(resolved).toHaveLength(0);
			expect(ambiguous).toHaveLength(0);
		});

		it("holds an implausibly wide pasuk range", () => {
			const { resolved, ambiguous } = extractCitations(
				"בראשית יח, א-מ כתוב.",
				catalogue,
			);
			expect(resolved).toHaveLength(0);
			expect(ambiguous).toHaveLength(1);
			expect(ambiguous[0].reason).toContain("implausible");
		});

		it("drops a bare run with too many numeric tokens", () => {
			const { resolved, ambiguous } = extractCitations(
				"בראשית א ב ג-ד נאמר.",
				catalogue,
			);
			expect(resolved).toHaveLength(0);
			expect(ambiguous).toHaveLength(0);
		});

		it("ignores numeric-looking text without a sefer name", () => {
			const { resolved, ambiguous } = extractCitations(
				"הערה של אב, גד בעניין זה.",
				catalogue,
			);
			expect(resolved).toHaveLength(0);
			expect(ambiguous).toHaveLength(0);
		});

		it("scans adversarial near-match input in linear time", () => {
			// Long runs of citation-shaped noise used to be a regex ReDoS
			// surface; the atom scanner must stay linear on the same input.
			const noise = "בראשית יח ב ג ד ה ו ז ח ".repeat(2000);
			const started = Date.now();
			const { resolved, ambiguous } = extractCitations(noise, catalogue);
			expect(Date.now() - started).toBeLessThan(1000);
			expect(ambiguous).toHaveLength(0);
			expect(resolved.length).toBeGreaterThan(0);
		});

		it("labels a range with its end pasuk", () => {
			const { resolved } = extractCitations("בראשית יח, ב-ה מראה.", catalogue);
			expect(resolved[0].label).toContain("-5");
		});

		it("holds a citation whose perek matches several catalogue rows", () => {
			const { ambiguous } = extractCitations("בראשית יח, ב כתוב.", {
				...catalogue,
				perakim: [
					...catalogue.perakim,
					{
						id: 1818,
						seferName: "בראשית",
						additionalLetter: null,
						perekInContext: 18,
						pasukCount: 33,
					},
				],
			});
			expect(ambiguous).toHaveLength(1);
			expect(ambiguous[0].reason).toContain("perakim");
		});
	});

	describe("with numeral atoms carrying quote marks", () => {
		it("resolves a gershayim-marked numeral", () => {
			const { resolved, ambiguous } = extractCitations(
				'בראשית י"ח, ב.',
				catalogue,
			);
			expect(ambiguous).toHaveLength(0);
			expect(resolved).toHaveLength(1);
			expect(resolved[0].perekId).toBe(18);
			expect(resolved[0].pasuk).toBe(2);
		});

		it("drops a numeral whose mark sits before any letter", () => {
			const { resolved, ambiguous } = extractCitations(
				'בראשית "א, ב.',
				catalogue,
			);
			expect(resolved).toHaveLength(0);
			expect(ambiguous).toHaveLength(0);
		});

		it("drops an atom made only of quote marks", () => {
			const { resolved, ambiguous } = extractCitations(
				"בראשית \"', ב.",
				catalogue,
			);
			expect(resolved).toHaveLength(0);
			expect(ambiguous).toHaveLength(0);
		});
	});

	describe("with malformed citation shapes", () => {
		it("ignores a numeral pair not preceded by a word", () => {
			const { resolved, ambiguous } = extractCitations(
				"ראה (יח, ב) בפרק.",
				catalogue,
			);
			expect(resolved).toHaveLength(0);
			expect(ambiguous).toHaveLength(0);
		});

		it("ignores a comma whose left side is not a numeral", () => {
			const { resolved, ambiguous } = extractCitations(
				"בראשית המאמר, ב.",
				catalogue,
			);
			expect(resolved).toHaveLength(0);
			expect(ambiguous).toHaveLength(0);
		});

		it("ignores a comma whose right side is not a numeral", () => {
			const { resolved, ambiguous } = extractCitations(
				"בראשית יח, המאמר.",
				catalogue,
			);
			expect(resolved).toHaveLength(0);
			expect(ambiguous).toHaveLength(0);
		});

		it("holds a reversed pasuk range as implausible", () => {
			const { resolved, ambiguous } = extractCitations(
				"בראשית יח, ה-ב.",
				catalogue,
			);
			expect(resolved).toHaveLength(0);
			expect(ambiguous).toHaveLength(1);
			expect(ambiguous[0].reason).toContain("implausible");
		});

		it("resolves a citation even when the pasuk bound is unknown", () => {
			const unbounded: typeof catalogue = {
				...catalogue,
				perakim: catalogue.perakim.map((p) => ({
					...p,
					pasukCount: null,
				})),
			};
			const { resolved, ambiguous } = extractCitations(
				"בראשית א, צ.",
				unbounded,
			);
			expect(ambiguous).toHaveLength(0);
			expect(resolved).toHaveLength(1);
			expect(resolved[0].pasuk).toBe(90);
		});
	});

	describe("with the פרק/פסוק keyword form", () => {
		it("resolves the phrasing with a comma before פסוק", () => {
			const { resolved } = extractCitations(
				"בראשית פרק יח, פסוק ב.",
				catalogue,
			);
			expect(resolved).toHaveLength(1);
			expect(resolved[0].perekId).toBe(18);
			expect(resolved[0].pasuk).toBe(2);
		});

		it("ignores פסוק not followed by a numeral", () => {
			const { resolved, ambiguous } = extractCitations(
				"בראשית פרק יח פסוק המאמר.",
				catalogue,
			);
			expect(resolved).toHaveLength(0);
			expect(ambiguous).toHaveLength(0);
		});

		it("ignores a פסוק span without the פרק keyword", () => {
			const { resolved, ambiguous } = extractCitations(
				"בראשית יח פסוק ב.",
				catalogue,
			);
			expect(resolved).toHaveLength(0);
			expect(ambiguous).toHaveLength(0);
		});

		it("ignores a פסוק span with no perek numeral at all", () => {
			const { resolved, ambiguous } = extractCitations("פסוק ב.", catalogue);
			expect(resolved).toHaveLength(0);
			expect(ambiguous).toHaveLength(0);
		});

		it("ignores a פסוק span with no sefer slot before פרק", () => {
			const { resolved, ambiguous } = extractCitations(
				"פרק יח פסוק ב.",
				catalogue,
			);
			expect(resolved).toHaveLength(0);
			expect(ambiguous).toHaveLength(0);
		});

		it("resolves an additional-letter citation in the keyword form", () => {
			const { resolved } = extractCitations("שמואל ב פרק ה פסוק ז.", catalogue);
			expect(resolved).toHaveLength(1);
			expect(resolved[0].perekId).toBe(605);
			expect(resolved[0].pasuk).toBe(7);
		});

		it("resolves a pasuk range in the keyword form", () => {
			const { resolved } = extractCitations(
				"בראשית פרק יח פסוק ב-ה.",
				catalogue,
			);
			expect(resolved).toHaveLength(1);
			expect(resolved[0].pasuk).toBe(2);
			expect(resolved[0].pasukTo).toBe(5);
		});
	});

	describe("with the bare form's optional third token", () => {
		it("resolves a bare citation carrying a pasuk range", () => {
			const { resolved } = extractCitations("בראשית יח ב-ג.", catalogue);
			expect(resolved).toHaveLength(1);
			expect(resolved[0].perekId).toBe(18);
			expect(resolved[0].pasuk).toBe(2);
			expect(resolved[0].pasukTo).toBe(3);
		});
	});

	describe("with quoted sefer surfaces", () => {
		it("resolves a sefer name wrapped in quote marks", () => {
			const { resolved } = extractCitations(
				'המאמר "בראשית" יח, ב אומר.',
				catalogue,
			);
			expect(resolved).toHaveLength(1);
			expect(resolved[0].perekId).toBe(18);
		});
	});
});

describe("citationEvidence", () => {
	it("carries the quote and span", () => {
		const ev = citationEvidence({
			perekId: 18,
			pasuk: 2,
			pasukTo: 2,
			label: "x",
			quote: "בראשית יח, ב",
			spanStart: 4,
			spanEnd: 17,
		});
		expect(ev).toEqual({
			quote: "בראשית יח, ב",
			spanStart: 4,
			spanEnd: 17,
		});
	});
});
