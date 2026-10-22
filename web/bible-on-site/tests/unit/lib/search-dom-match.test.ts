/**
 * @jest-environment jsdom
 */
import {
	collectTextNodes,
	highlightDomMatch,
	locateNormalized,
	rawRangeFromSpan,
} from "@/lib/search/dom-match";
import { normalizeWithMap } from "@/lib/search/normalize";

describe("normalizeWithMap", () => {
	it("emits the same normalized text as normalizeSearchText", () => {
		const raw = ' א  בְּג "ד" ';
		const { normalized, map } = normalizeWithMap(raw);
		expect(normalized).toBe("א בג ד");
		expect(map).toHaveLength(normalized.length);
	});

	it("maps each output char to the raw index that produced it", () => {
		const { map } = normalizeWithMap("בְּרֵאשִׁית בָּרָא");
		// 'ברא' of the second word: normalized indexes 7-9 → raw 12, 15, 17.
		expect(map[7]).toBe(12);
		expect(map[8]).toBe(15);
		expect(map[9]).toBe(17);
	});

	it("maps astral-plane characters to their surrogate-pair index", () => {
		// U+13000 Egyptian hieroglyph occupies two UTF-16 units; both normalized
		// units map back to the pair's raw start, matching the C# twin.
		const { normalized, map } = normalizeWithMap("א𓀀ב");
		expect(map).toHaveLength(normalized.length);
		expect(map).toEqual([0, 1, 1, 3]);
	});

	it("decomposes precomposed code points", () => {
		// יִ (yod+hiriq presentation form) decomposes under NFD and the mark is
		// filtered, leaving 'י' — same for precomposed é → 'e'.
		expect(normalizeWithMap("יִ")).toEqual({ normalized: "י", map: [0] });
		expect(normalizeWithMap("é")).toEqual({ normalized: "e", map: [0] });
	});
});

describe("collectTextNodes", () => {
	it("returns text nodes in order with concatenated text", () => {
		const root = document.createElement("div");
		root.innerHTML = "<p>אחד <b>שתיים</b></p><p>שלוש</p>";
		const { nodes, text } = collectTextNodes(root);
		expect(text).toBe("אחד שתייםשלוש");
		expect(nodes).toHaveLength(3);
		expect(nodes[1].start).toBe(4);
	});

	it("skips script and style bodies", () => {
		const root = document.createElement("div");
		root.innerHTML = "<p>אחד</p><script>var x = 1;</script><style>p{}</style>";
		const { text } = collectTextNodes(root);
		expect(text).toBe("אחד");
	});
});

describe("locateNormalized", () => {
	it("finds whole-word phrases", () => {
		expect(locateNormalized("דבור בראשית ברא אלהים", "בראשית ברא")).toEqual({
			start: 5,
			end: 15,
		});
	});

	it("finds substrings inside longer words", () => {
		expect(locateNormalized("אמר בראשית", "ראש")).toEqual({
			start: 5,
			end: 8,
		});
	});

	it("marks whole words for fuzzy term matches", () => {
		expect(locateNormalized("אמר בראשית", "בראשים")).toEqual({
			start: 4,
			end: 10,
		});
	});

	it("returns the first occurrence for repeated queries", () => {
		expect(locateNormalized("אחד בראשית ועוד בראשית", "בראשית")).toEqual({
			start: 4,
			end: 10,
		});
	});

	it("returns null when nothing matches", () => {
		expect(locateNormalized("אמר דבר אחר", "קוראים")).toBeNull();
		expect(locateNormalized("אמר דבר אחר", "")).toBeNull();
		expect(locateNormalized("", "דבר")).toBeNull();
	});
});

describe("rawRangeFromSpan", () => {
	it("expands normalized offsets over combining marks", () => {
		const raw = "בְּרֵאשִׁית בָּרָא";
		const { map } = normalizeWithMap(raw);
		expect(rawRangeFromSpan(raw, map, { start: 7, end: 10 })).toEqual({
			start: 12,
			end: 18,
		});
	});

	it("skips erased quotes", () => {
		const raw = 'שליט"א';
		const { map } = normalizeWithMap(raw);
		expect(rawRangeFromSpan(raw, map, { start: 4, end: 5 })).toEqual({
			start: 5,
			end: 6,
		});
	});

	it("returns null on an empty map", () => {
		expect(rawRangeFromSpan("", [], { start: 0, end: 1 })).toBeNull();
	});

	it("returns a point range for an empty span", () => {
		const { map } = normalizeWithMap("אב גד");
		expect(rawRangeFromSpan("אב גד", map, { start: 1, end: 1 })).toEqual({
			start: 1,
			end: 1,
		});
	});

	it("extends the range over trailing combining marks", () => {
		// 'ב' carries hiriq + dagesh, which produce no normalized char but must
		// stay inside the highlighted glyph.
		const raw = "אבִּגד";
		const { normalized, map } = normalizeWithMap(raw);
		expect(normalized).toBe("אבגד");
		expect(rawRangeFromSpan(raw, map, { start: 1, end: 2 })).toEqual({
			start: 1,
			end: 4,
		});
	});
});

describe("highlightDomMatch", () => {
	it("wraps a single-node match in a mark", () => {
		const root = document.createElement("div");
		root.innerHTML = "<p>אמר בראשית ברא</p>";
		const marks = highlightDomMatch(root, "בראשית", "hit");
		expect(marks).toHaveLength(1);
		expect(marks[0].tagName).toBe("MARK");
		expect(marks[0].className).toBe("hit");
		expect(marks[0].textContent).toBe("בראשית");
	});

	it("wraps a match spanning text-node boundaries in several marks", () => {
		const root = document.createElement("div");
		root.innerHTML = "<p>ברא<b>שי</b>ת ברא אלהים</p>";
		const marks = highlightDomMatch(root, "בראשית ברא", "hit");
		// בראשית ברא crosses the <b> boundary plus following text nodes.
		expect(marks.length).toBeGreaterThanOrEqual(3);
		expect(marks.map((mark) => mark.textContent).join("")).toBe("בראשית ברא");
	});

	it("finds the match through niqqud the index normalized away", () => {
		const root = document.createElement("div");
		root.innerHTML = "<p>אמר בְּרֵאשִׁית בָּרָא</p>";
		const marks = highlightDomMatch(root, "בראשית", "hit");
		expect(marks).toHaveLength(1);
		expect(marks[0].textContent).toBe("בְּרֵאשִׁית");
	});

	it("matches the second occurrence reached through DOM order", () => {
		const root = document.createElement("div");
		root.innerHTML = "<p>אחד</p><p>מונח בפסוק ועוד מונח</p>";
		// First occurrence wins — the phrase anchors the whole-document position.
		const marks = highlightDomMatch(root, "מונח", "hit");
		expect(marks).toHaveLength(1);
		expect(marks[0].textContent).toBe("מונח");
		expect(marks[0].parentElement?.textContent).toContain("מונח בפסוק");
	});

	it("returns no marks when the phrase is absent", () => {
		const root = document.createElement("div");
		root.innerHTML = "<p>טקסט אחר</p>";
		expect(highlightDomMatch(root, "מונח", "hit")).toEqual([]);
		expect(root.querySelector("mark")).toBeNull();
	});

	it("returns no marks for an empty phrase", () => {
		const root = document.createElement("div");
		root.innerHTML = "<p>טקסט</p>";
		expect(highlightDomMatch(root, "", "hit")).toEqual([]);
	});
});
