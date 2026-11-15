/**
 * @jest-environment node
 */
import {
	editDistance,
	maxEdits,
	prepareQuery,
	scorePrepared,
	scorePreparedText,
	tokenScore,
} from "@/lib/search/score";
import { normalizeSearchText } from "@/lib/search/normalize";

const score = (text: string, query: string) =>
	scorePrepared(normalizeSearchText(text), prepareQuery(query));

describe("maxEdits", () => {
	it("allows no edits for short terms, one for medium, two for long", () => {
		expect(maxEdits("אבג")).toBe(0);
		expect(maxEdits("אבגד")).toBe(1);
		expect(maxEdits("אבגדהוז")).toBe(1);
		expect(maxEdits("אבגדהוזח")).toBe(2);
	});
});

describe("editDistance", () => {
	it("preserves bounded Levenshtein results for every one-edit operation", () => {
		const words = [""];
		let level = [""];
		for (let size = 0; size < 4; size++) {
			level = level.flatMap((word) => [`${word}א`, `${word}ב`]);
			words.push(...level);
		}
		words.push("בראשית", "בראשת", "בראישית", "בראשים", "😀", "😁", "a😀");
		const reference = (left: string, right: string) => {
			const rows = Array.from({ length: left.length + 1 }, (_, i) =>
				Array.from({ length: right.length + 1 }, (_, j) => (i === 0 ? j : i)),
			);
			for (let i = 1; i <= left.length; i++) {
				for (let j = 1; j <= right.length; j++) {
					rows[i][j] = Math.min(
						rows[i - 1][j] + 1,
						rows[i][j - 1] + 1,
						rows[i - 1][j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
					);
				}
			}
			return rows[left.length][right.length];
		};
		for (const left of words) {
			for (const right of words) {
				expect(editDistance(left, right, 1)).toBe(
					Math.min(reference(left, right), 2),
				);
			}
		}
	});

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

describe("scorePrepared", () => {
	it("scores exact text-phrase equality at 110", () => {
		expect(score("בראשית", "בְּרֵאשִׁית")).toBe(110);
	});

	it("scores a whole-word phrase containment at 100", () => {
		expect(score("אל בריאת בראשית העולם", "בראשית")).toBe(100);
	});

	it("scores all-terms-present by the weakest term match", () => {
		// Terms are present but not adjacent, so the phrase tier does not apply.
		expect(score("ברא אלהים בראשית", "בראשית ברא")).toBe(90);
		// A prefix-matched term pulls the group's minimum down to 80.
		expect(score("ברא אלהים בראשיתו", "בראשית ברא")).toBe(80);
	});

	it("fails when any term is missing", () => {
		expect(score("בראשית ברא אלהים", "בראשית שלום")).toBe(0);
	});

	it("ignores niqqud in both text and query", () => {
		expect(score("בְּרֵאשִׁית בָּרָא", "בראשית ברא")).toBeGreaterThan(0);
	});

	it("returns zero for an empty query", () => {
		expect(score("בראשית", "")).toBe(0);
	});

	it("keeps the strongest match even when fuzzy words appear before it", () => {
		expect(score("בראשת בראשיתו אלהים", "בראשית")).toBe(80);
		expect(score("בראשת בראשיתו אלהים ברא", "בראשית ברא")).toBe(80);
		expect(score("בראשת בראשית אלהים ברא", "בראשית ברא")).toBe(90);
		expect(score("בראשת אלהים", "בראשית")).toBe(60);
	});

	it("matches per-word scoring across exact, prefix, fuzzy and missing terms", () => {
		const words = [
			"בראשית",
			"בראשיתו",
			"בראשת",
			"ברא",
			"אלהים",
			"אבגדהוזח",
			"אבגדהוזט",
			"שלום",
		];
		for (const left of words) {
			for (const right of words) {
				const text = `${left} ${right}`;
				for (const phrase of [...words, "בראשית ברא", "שלום אלהים"]) {
					const prepared = prepareQuery(phrase);
					const scores = prepared.terms.map((term) =>
						Math.max(...[left, right].map((word) => tokenScore(word, term))),
					);
					const expected =
						text === phrase
							? 110
							: ` ${text} `.includes(` ${phrase} `)
								? 100
								: Math.min(...scores);
					expect(scorePrepared(normalizeSearchText(text), prepared)).toBe(
						expected,
					);
				}
			}
		}
	});
});

describe("scorePreparedText", () => {
	it("preserves full-text scoring across phrase boundaries and Unicode normalization", () => {
		const texts = [
			"",
			"בראשית",
			"  בראשית  ",
			"מבוא בראשית סיום",
			"מבוא בראשית",
			"בראשית סיום",
			"מבוא (בראשית) סיום",
			"מבואאבראשית סיום",
			"מבוא בראשיתו סיום",
			"מבוא בראשיתו עוד בראשית סיום",
			"מבוא בְּרֵאשִׁית סיום",
			"מבוא אב'בראשית סיום",
			"מבוא בראשית  ברא סיום",
			"מבוא בראשית ברא סיום",
			"alpha κόσμος Σ 𐐨abcdefg omega",
		];
		for (const text of texts) {
			for (const query of [
				"",
				"בראשית",
				"בראשית ברא",
				"ירושלימ",
				"κόσμοσ",
				"𐐨abcdefh",
			]) {
				expect(scorePreparedText(text, prepareQuery(query))).toBe(
					score(text, query),
				);
			}
		}
	});

	it("scores a proven phrase in a large body without normalizing the entire body", () => {
		const prepared = prepareQuery("בראשית");
		const text = `${"מבוא ".repeat(10_000)}בראשית ${"סיום ".repeat(10_000)}`;
		const normalize = String.prototype.normalize;
		const spy = jest
			.spyOn(String.prototype, "normalize")
			.mockImplementation(function (this: string, form?: string) {
				if (this.length > 256)
					throw new Error("Unnecessary full-body normalization");
				return normalize.call(this, form);
			});
		try {
			expect(scorePreparedText(text, prepared)).toBe(100);
		} finally {
			spy.mockRestore();
		}
	});
});
