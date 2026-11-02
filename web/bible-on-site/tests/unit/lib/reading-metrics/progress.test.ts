/**
 * Geometry tests for the word-weighted reading-position engine (#2607).
 */
import {
	positionUnits,
	progressFraction,
	readableDomSegments,
	readingAnchor,
	wordsPassedAt,
	type UnitLineBox,
} from "../../../../src/lib/reading-metrics/progress";

const lines = (...tops: number[]): UnitLineBox[] =>
	tops.map((top) => ({ top, height: 10 }));

describe("readingAnchor", () => {
	it("returns 0 at rest and scrollHeight at max scroll", () => {
		expect(readingAnchor(0, 1000, 200)).toBe(0);
		expect(readingAnchor(800, 1000, 200)).toBe(1000);
	});

	it("scales an intermediate scroll position onto the content axis", () => {
		// Half of the scrollable range → half of the content axis.
		expect(readingAnchor(400, 1000, 200)).toBe(500);
	});

	it("clamps out-of-range scroll positions", () => {
		expect(readingAnchor(-50, 1000, 200)).toBe(0);
		expect(readingAnchor(900, 1000, 200)).toBe(1000);
	});

	it("reports fully read when the content does not scroll", () => {
		expect(readingAnchor(0, 100, 200)).toBe(100);
	});

	it("sweeps the measured content extent, not the whole scroller", () => {
		// A 2000px scroller whose counted text occupies [300, 800]: the rest
		// (nav, commentary sections) must not hold the anchor short of the
		// text end nor delay it past the text start.
		expect(readingAnchor(0, 2000, 200, 300, 800)).toBe(300);
		expect(readingAnchor(1800, 2000, 200, 300, 800)).toBe(800);
		expect(readingAnchor(900, 2000, 200, 300, 800)).toBe(550);
	});

	it("returns the content bottom for a non-scrollable extent", () => {
		expect(readingAnchor(0, 100, 200, 10, 80)).toBe(80);
	});
});

describe("positionUnits", () => {
	it("orders units by rendered position and recomputes wordsBefore", () => {
		// Stored order (perush A notes then perush B notes) differs from the
		// rendered interleave — the pane groups by pasuk.
		const units = positionUnits([
			{ top: 300, bottom: 400, lines: lines(300), wordCount: 50 },
			{ top: 0, bottom: 100, lines: lines(0), wordCount: 30 },
			{ top: 100, bottom: 300, lines: lines(100, 200), wordCount: 20 },
		]);
		expect(units.map((u) => u.wordCount)).toEqual([30, 20, 50]);
		expect(units.map((u) => u.wordsBefore)).toEqual([0, 30, 50]);
	});

	it("breaks equal tops by bottom for a stable order", () => {
		const units = positionUnits([
			{ top: 0, bottom: 200, lines: [], wordCount: 5 },
			{ top: 0, bottom: 100, lines: [], wordCount: 7 },
		]);
		expect(units.map((u) => u.wordCount)).toEqual([7, 5]);
	});
});

describe("wordsPassedAt", () => {
	const units = positionUnits([
		{ top: 0, bottom: 100, lines: lines(0, 50), wordCount: 40 },
		{ top: 100, bottom: 300, lines: lines(100, 200), wordCount: 60 },
	]);

	it("counts nothing above the first unit", () => {
		expect(wordsPassedAt(-1, units)).toBe(0);
	});

	it("interpolates inside a unit by passed text lines", () => {
		// Anchor mid-way through the second line of unit 1 → 1.5 of 2 lines.
		expect(wordsPassedAt(55, units)).toBeCloseTo((1.5 / 2) * 40, 5);
	});

	it("counts full units above and partial inside the straddling unit", () => {
		// Anchor at the top edge of unit 2's second line → 40 + half of 60.
		expect(wordsPassedAt(200, units)).toBeCloseTo(40 + 30, 5);
	});

	it("counts every word past the last unit", () => {
		expect(wordsPassedAt(400, units)).toBe(100);
	});

	it("counts an unmeasurable (line-less) unit by position", () => {
		const emptyUnits = positionUnits([
			{ top: 0, bottom: 50, lines: [], wordCount: 10 },
		]);
		expect(wordsPassedAt(25, emptyUnits)).toBe(10);
	});
});

describe("progressFraction", () => {
	it("returns 0 for empty content", () => {
		expect(progressFraction(0, [], 0)).toBe(0);
	});

	it("clamps to [0, 1]", () => {
		const units = positionUnits([
			{ top: 0, bottom: 10, lines: lines(0), wordCount: 10 },
		]);
		expect(progressFraction(-5, units, 10)).toBe(0);
		expect(progressFraction(50, units, 10)).toBe(1);
	});
});

describe("readableDomSegments", () => {
	const build = (html: string): Text[][] => {
		// DOMParser keeps the fixture markup static (no script execution and
		// no innerHTML assignment of variable data).
		const doc = new DOMParser().parseFromString(html, "text/html");
		return readableDomSegments(doc.body);
	};

	const text = (segment: Text[]) =>
		segment.map((t) => t.data).join("");

	it("splits text at block-boundary closes like the server scanner", () => {
		const segments = build("<p>אחת שתים</p><p>שלוש ארבע</p>");
		expect(segments.map(text)).toEqual(["אחת שתים", "שלוש ארבע"]);
	});

	it("keeps inline markup inside one segment", () => {
		const segments = build("<p>אחת <b>שתים</b> שלוש</p>");
		expect(segments.map(text)).toEqual(["אחת שתים שלוש"]);
	});

	it("treats br as a boundary inside a block", () => {
		const segments = build("<p>אחת<br>שתים</p>");
		expect(segments.map(text)).toEqual(["אחת", "שתים"]);
	});

	it("drops whitespace-only and non-word segments", () => {
		const segments = build("<p>   </p><p>מילה</p>");
		expect(segments.map(text)).toEqual(["מילה"]);
	});

	it("ignores script bodies even when they hold text", () => {
		const segments = build("<p>מילה</p><script>var x=1;</script>");
		expect(segments.map(text)).toEqual(["מילה"]);
	});

	it("splits nested blocks where the scanner's close tags were", () => {
		const segments = build(
			"<div><p>ראשון</p><p>שני</p></div><p>שלישי</p>",
		);
		expect(segments.map(text)).toEqual(["ראשון", "שני", "שלישי"]);
	});
});
