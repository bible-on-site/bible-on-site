/**
 * @jest-environment node
 *
 * Visual bidi regression for the learning-calendar PDF (issue #2620) plus the
 * branded layout contract (issue #2727).
 *
 * Generates real PDFs with the production Frank Ruhl fonts and inspects the
 * emitted content stream: every text-show op's glyph codes are decoded back
 * to Unicode through the embedded ToUnicode CMap. The decoded sequence is
 * the visual order a renderer paints — it must equal the bidi-reordered
 * (UAX #9) form of the logical string, which for pure Hebrew is a plain
 * character reversal.
 *
 * Link coverage inspects the page Annots array directly: URI targets and
 * rectangles over the final drawn label positions.
 */

import bidiFactory from "bidi-js";
import {
	decodePDFRawStream,
	PDFArray,
	PDFDict,
	PDFDocument,
	PDFName,
	PDFNumber,
	PDFRawStream,
	PDFStream,
	PDFString,
} from "pdf-lib";
import {
	buildMonth,
	type CalendarDay,
	getCycle,
	getCycleLabel,
	getMonthLabel,
	getMonthOrder,
	getPerekSource,
	type MonthCell,
	type MonthRef,
} from "@/data/learning-schedule";
import { SITE_ORIGIN } from "@/lib/seo/jsonld";
import {
	type CalendarPdfInput,
	type CalendarPdfMonth,
	generateCalendarPdf,
} from "@/lib/download/calendar-pdf";

const bidi = bidiFactory();

/* ─────────────── PDF content-stream extraction helpers ─────────────── */

interface TextOp {
	/** Decoded via the font's embedded ToUnicode CMap — the searchable text. */
	text: string;
	/** Glyph ids as encoded in the content stream (subset-safe). */
	codes: number[];
	x: number;
	y: number;
	fontName: string;
}

function latin1(bytes: Uint8Array): string {
	let out = "";
	for (const b of bytes) out += String.fromCharCode(b);
	return out;
}

/** Parse `beginbfchar`/`beginbfrange` blocks of a ToUnicode CMap stream. */
function parseToUnicodeCMap(cmap: string): Map<number, string> {
	const map = new Map<number, string>();
	const dstString = (hex: string) => {
		let s = "";
		for (let i = 0; i + 4 <= hex.length; i += 4) {
			s += String.fromCodePoint(parseInt(hex.slice(i, i + 4), 16));
		}
		return s;
	};
	for (const block of cmap.matchAll(/beginbfchar\s*([\s\S]*?)\s*endbfchar/g)) {
		for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
			map.set(parseInt(m[1], 16), dstString(m[2]));
		}
	}
	for (const block of cmap.matchAll(
		/beginbfrange\s*([\s\S]*?)\s*endbfrange/g,
	)) {
		for (const m of block[1].matchAll(
			/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g,
		)) {
			const from = parseInt(m[1], 16);
			const to = parseInt(m[2], 16);
			const dst = parseInt(m[3], 16);
			for (let c = from; c <= to; c++) {
				map.set(c, String.fromCodePoint(dst + (c - from)));
			}
		}
	}
	return map;
}

function lookupDict(doc: PDFDocument, obj: unknown): PDFDict | undefined {
	const resolved = doc.context.lookup(obj as never);
	return resolved instanceof PDFDict ? resolved : undefined;
}

/** A Link/URI annotation as written on a page. */
interface LinkAnnot {
	uri: string;
	rect: number[];
}

/** Every page's Link annotations — URI target and bounds. */
async function extractLinkAnnots(pdf: Uint8Array): Promise<LinkAnnot[][]> {
	const doc = await PDFDocument.load(pdf);
	return doc.getPages().map((page) => {
		const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
		if (annots === undefined) return [];
		return annots.asArray().map((ref) => {
			const dict = doc.context.lookup(ref, PDFDict);
			const rect = doc.context
				.lookup(dict.get(PDFName.of("Rect")), PDFArray)
				.asArray()
				.map((n) => doc.context.lookup(n, PDFNumber).asNumber());
			const action = doc.context.lookup(
				dict.get(PDFName.of("A")),
				PDFDict,
			);
			const uri = doc.context
				.lookup(action.get(PDFName.of("URI")), PDFString)
				.decodeText();
			return { uri, rect };
		});
	});
}

/** Whether a page draws an embedded image (the brand logo). */
async function pageDrawsImage(pdf: Uint8Array, pageIndex: number): Promise<boolean> {
	const doc = await PDFDocument.load(pdf);
	const page = doc.getPages()[pageIndex];
	const xobjects = lookupDict(
		doc,
		page.node.Resources()?.lookup(PDFName.of("XObject")),
	);
	for (const [, ref] of xobjects?.entries() ?? []) {
		const resolved = doc.context.lookup(ref as never);
		const dict = resolved instanceof PDFStream ? resolved.dict : undefined;
		if (dict?.lookup(PDFName.of("Subtype"))?.toString() === "/Image") {
			return true;
		}
	}
	return false;
}

/**
 * Decode every page's content stream into ordered text-show ops.
 * Positions come from the text matrix (Tm) / text-move (Td) ops.
 */
async function extractTextOps(pdf: Uint8Array): Promise<TextOp[][]> {
	const doc = await PDFDocument.load(pdf);
	const pages: TextOp[][] = [];

	for (const page of doc.getPages()) {
		// Per-resource-name ToUnicode maps.
		const cmaps = new Map<string, Map<number, string>>();
		const fonts = lookupDict(
			doc,
			page.node.Resources()?.lookup(PDFName.of("Font")),
		);
		for (const [name, ref] of fonts?.entries() ?? []) {
			const fontDict = lookupDict(doc, ref);
			const toUnicode = fontDict?.lookup(PDFName.of("ToUnicode"));
			const stream = doc.context.lookup(toUnicode as never);
			if (stream instanceof PDFRawStream) {
				cmaps.set(
					name.asString().replace(/^\//, ""),
					parseToUnicodeCMap(latin1(decodePDFRawStream(stream).decode())),
				);
			}
		}

		// Concatenate all content streams.
		const contents = page.node.Contents();
		const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
		let streamText = "";
		for (const ref of refs) {
			const raw = doc.context.lookup(ref as never);
			if (raw instanceof PDFRawStream) {
				streamText += latin1(decodePDFRawStream(raw).decode());
			}
		}

		// Token scan: font selection, text matrix/move, hex strings in Tj/TJ.
		const ops: TextOp[] = [];
		let fontName = "";
		let x = 0;
		let y = 0;
		const opRe =
			/\/(\S+)\s+[\d.]+\s+Tf|(-?[\d.]+)\s+(-?[\d.]+)\s+Td|-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm|<([0-9A-Fa-f]+)>\s*Tj|\[([^\]]*)\]\s*TJ/g;
		for (const m of streamText.matchAll(opRe)) {
			if (m[1] !== undefined) {
				fontName = m[1];
			} else if (m[2] !== undefined) {
				x += Number(m[2]);
				y += Number(m[3]);
			} else if (m[4] !== undefined) {
				x = Number(m[4]);
				y = Number(m[5]);
			} else {
				const hexes = m[6]
					? [m[6]]
					: [...(m[7] ?? "").matchAll(/<([0-9A-Fa-f]+)>/g)].map((h) => h[1]);
				const cmap = cmaps.get(fontName) ?? new Map<number, string>();
				const codes: number[] = [];
				let text = "";
				for (const hex of hexes) {
					for (let i = 0; i + 4 <= hex.length; i += 4) {
						const code = parseInt(hex.slice(i, i + 4), 16);
						codes.push(code);
						text += cmap.get(code) ?? "";
					}
				}
				ops.push({ text, codes, x, y, fontName });
			}
		}
		pages.push(ops);
	}
	return pages;
}

/** Ops on one baseline, in left-to-right paint order. */
function opsAtY(ops: TextOp[], y: number): TextOp[] {
	return ops.filter((o) => Math.abs(o.y - y) < 0.5).sort((a, b) => a.x - b.x);
}

/** UAX #9 visual-order oracle for a logical string. */
function visualOrder(logical: string): string {
	return bidi.getReorderedString(
		logical,
		bidi.getEmbeddingLevels(logical, "auto"),
	);
}

/* ───────────────────────────── fixtures ───────────────────────────── */

function scheduleDay(over: Partial<CalendarDay>): CalendarDay {
	return { day: 1, status: "study", perekId: 1, ...over } as CalendarDay;
}

function cellsForDays(days: CalendarDay[]): MonthCell[] {
	return days.map((day) => ({ day }));
}

/**
 * A fixture month carrying the structured identity the renderer needs for
 * per-page range headings (#2727) — defaults to Elul 5785.
 */
function fakeMonth(
	title: string,
	cells: MonthCell[],
	ref: MonthRef = { year: 5785, month: 12 },
): CalendarPdfMonth {
	return { title, year: ref.year, month: ref.month, cells };
}

function fakeInput(
	months: CalendarPdfMonth[],
	overrides: Partial<CalendarPdfInput> = {},
): CalendarPdfInput {
	return {
		scope: months.length === 1 ? "month" : "year",
		title: "לוח לימוד יומי",
		months,
		dayLabel: () => "",
		...overrides,
	};
}

const STUDY = scheduleDay({ day: 1, perekId: 1 });
const REVIEW = scheduleDay({
	day: 2,
	status: "review",
	perekId: 7,
	reviewPerekIds: [3, 4, 5, 6, 7],
});
const UNNUMBERED = scheduleDay({ day: 14, status: "none", perekId: undefined });

async function generateAndExtract(
	input: CalendarPdfInput,
): Promise<TextOp[][]> {
	return extractTextOps(await generateCalendarPdf(input));
}

/* ────────────────────────────── tests ─────────────────────────────── */

describe("generateCalendarPdf bidi rendering (issue #2620)", () => {
	it("draws the document title in visual RTL glyph order", async () => {
		const pages = await generateAndExtract(
			fakeInput([fakeMonth("אלול ה'תשפה", cellsForDays([STUDY]))]),
		);
		const texts = pages[0].map((o) => o.text);
		// Visual order of "לוח לימוד יומי" is "ימוי דומיל חול".
		expect(texts).toContain("ימוי דומיל חול");
	});

	it("draws weekday labels in visual order, not logical order", async () => {
		const pages = await generateAndExtract(
			fakeInput([fakeMonth("אלול", cellsForDays([STUDY]))]),
		);
		const texts = pages[0].map((o) => o.text);
		expect(texts).toContain("ישילש"); // שלישי
		expect(texts).toContain("ןושאר"); // ראשון
		expect(texts).toContain("תבש"); // שבת
		expect(texts).not.toContain("שלישי");
	});

	it("draws multi-letter Hebrew day numbers in visual order", async () => {
		const pages = await generateAndExtract(
			fakeInput([fakeMonth("אלול", cellsForDays([UNNUMBERED]))]),
		);
		const texts = pages[0].map((o) => o.text);
		// Day 14 → toLetters(14, addQuotes) = 'י"ד' → visual 'ד"י'.
		expect(texts).toContain('ד"י');
	});

	it("draws perek sources and review ranges in visual order", async () => {
		const pages = await generateAndExtract(
			fakeInput([fakeMonth("אלול", cellsForDays([STUDY, REVIEW]))], {
				dayLabel: (day) =>
					day.status === "review" && day.reviewPerekIds
						? `${getPerekSource(day.reviewPerekIds[0])} - ${getPerekSource(day.reviewPerekIds[day.reviewPerekIds.length - 1])}`
						: getPerekSource(day.perekId ?? 1),
			}),
		);
		const texts = pages[0].map((o) => o.text).join("");
		// "בראשית א" → visual "א תישארב".
		expect(texts).toContain("א תישארב");
		// Review range "בראשית ג - בראשית ז" → visual "ז תישארב - ג תישארב".
		expect(texts).toContain("ז תישארב - ג תישארב");
	});

	it("keeps digits and Latin tokens un-reversed inside RTL text", async () => {
		const subtitle = "מחזור 12: שלב א (בדיקה) end";
		const pages = await generateAndExtract(
			fakeInput([fakeMonth("אלול", cellsForDays([STUDY]))], { subtitle }),
		);
		const texts = pages[0].map((o) => o.text).join("");
		expect(texts).toContain("12");
		expect(texts).not.toContain("21");
		expect(texts).toContain("end");
		// Mirrored parens: "(בדיקה)" in an RTL run renders '(' at the left and
		// ')' at the right — decoded extraction shows the mirrored glyphs.
		expect(texts).toContain("(הקידב)");
	});

	it("positions subtitle runs in exact UAX #9 visual order", async () => {
		const subtitle = "מחזור 4: כ״ה אדר ה'תשפ״ה - כ״ד אדר ה'תשצ״ו";
		const pages = await generateAndExtract(
			fakeInput([fakeMonth("אלול", cellsForDays([STUDY]))], { subtitle }),
		);
		// Find the subtitle baseline: the op containing the cycle digits.
		const digitOp = pages[0].find((o) => o.text === "4");
		expect(digitOp).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: asserted defined above
		const line = opsAtY(pages[0], digitOp!.y)
			.map((o) => o.text)
			.join("");
		expect(line).toBe(visualOrder(subtitle));
	});

	it("renders a real full-cycle page with correct visual order", async () => {
		const month = getCycleStartMonthLabel();
		const pages = await generateAndExtract(
			fakeInput([month, month], {
				scope: "cycle",
				subtitle: getCycleLabel(getCycle(4)),
				dayLabel: (day) => getPerekSource(day.perekId ?? 1),
			}),
		);
		// Cover page carries the document title; first data page the month.
		const coverTexts = pages[0].map((o) => o.text).join("");
		const dataTexts = pages[1].map((o) => o.text).join("");
		expect(coverTexts).toContain("ימוי דומיל חול");
		expect(dataTexts).toContain(visualOrder(month.title));
	});
});

function getCycleStartMonthLabel(): CalendarPdfMonth {
	const cycle = getCycle(4);
	const ref = {
		year: cycle.start.year,
		month: cycle.start.getUniformMonth(),
	};
	return fakeMonth(getMonthLabel(ref), buildMonth(ref.year, ref.month), ref);
}

describe("merged Friday-Shabbat review block (issue #2365)", () => {
	const PAIR_IDS = [1, 2, 3, 4, 5, 6, 7];
	const pair: CalendarDay[] = [
		scheduleDay({
			day: 12,
			status: "review",
			perekId: 7,
			reviewPerekIds: PAIR_IDS,
			dayOfWeek: 5,
			cycle: 4,
		}),
		scheduleDay({
			day: 13,
			status: "review",
			perekId: 7,
			reviewPerekIds: PAIR_IDS,
			dayOfWeek: 6,
			cycle: 4,
		}),
	];

	it("draws one block with both day numbers instead of two cells", async () => {
		const pages = await generateAndExtract(
			fakeInput([fakeMonth("אלול", cellsForDays(pair))], {
				dayLabel: (day) => getPerekSource(day.perekId ?? 1),
			}),
		);
		const texts = pages[0].map((o) => o.text).join("");
		// י"ב - י"ג in visual order.
		expect(texts).toContain(visualOrder('י"ב - י"ג'));
		// Saturday draws no second number of its own.
		expect(
			pages[0].filter((o) => o.text.includes('ב"י') || o.text.includes('ג"י')),
		).toHaveLength(1);
		// The review label still lands inside the merged cell.
		expect(texts).toContain(visualOrder(getPerekSource(7)));
	});

	it("dims the block only when both days dim", async () => {
		const input = (
			dimmed: (day: CalendarDay) => boolean,
		): CalendarPdfInput =>
			fakeInput([fakeMonth("אלול", cellsForDays(pair))], {
				dayLabel: (day) => getPerekSource(day.perekId ?? 1),
				dimmed,
			});
		const source = visualOrder(getPerekSource(7));

		// Friday alone dimmed: the shared block stays an active review cell.
		const partial = await generateAndExtract(input((d) => d.day === 12));
		expect(partial[0].map((o) => o.text).join("")).toContain(source);

		// Both dimmed: the label is suppressed with the rest of the cell.
		const full = await generateAndExtract(input(() => true));
		expect(full[0].map((o) => o.text).join("")).not.toContain(source);
	});

	it("keeps adjacent review days unmerged when their sets differ", async () => {
		const mismatched: CalendarDay[] = [
			scheduleDay({
				day: 12,
				status: "review",
				perekId: 7,
				reviewPerekIds: PAIR_IDS,
				dayOfWeek: 5,
				cycle: 4,
			}),
			scheduleDay({
				day: 13,
				status: "review",
				perekId: 8,
				reviewPerekIds: [...PAIR_IDS, 8],
				dayOfWeek: 6,
				cycle: 4,
			}),
		];
		const pages = await generateAndExtract(
			fakeInput([fakeMonth("אלול", cellsForDays(mismatched))], {
				dayLabel: (day) => getPerekSource(day.perekId ?? 1),
			}),
		);
		const texts = pages[0].map((o) => o.text).join("");
		expect(texts).toContain(visualOrder('י"ב'));
		expect(texts).toContain(visualOrder('י"ג'));
		expect(texts).not.toContain(visualOrder('י"ב - י"ג'));
	});
});

describe("fitText truncation", () => {
	it("truncates an over-wide day label to the longest fitting prefix", async () => {
		// A pure-Hebrew label renders as its own reversal, so the drawn op is
		// a repeated letter either way; truncation only shortens it.
		const pages = await generateAndExtract(
			fakeInput([fakeMonth("אלול", cellsForDays([STUDY]))], {
				dayLabel: () => "ץ".repeat(120),
			}),
		);
		const labelOps = pages[0].map((o) => o.text).filter((t) => /^ץ+$/.test(t));
		expect(labelOps).toHaveLength(1);
		expect(labelOps[0].length).toBeGreaterThan(0);
		expect(labelOps[0].length).toBeLessThan(120);
	});
});

describe("branded layout (issue #2727)", () => {
	const monthCells = cellsForDays([STUDY]);

	it("renders a month export as exactly one page", async () => {
		const pdf = await generateCalendarPdf(
			fakeInput([fakeMonth("אלול ה'תשפה", monthCells)], {
				title: "לוח לימוד יומי - אלול ה'תשפה - תנ\"ך על הפרק",
			}),
		);
		const pages = await extractTextOps(pdf);
		expect(pages).toHaveLength(1);
		// Logo above the calendar.
		expect(await pageDrawsImage(pdf, 0)).toBe(true);
		// Footer carries the document title and page number.
		const footer = opsAtY(pages[0], 11)
			.map((o) => o.text)
			.join("");
		expect(footer).toContain("1");
		const texts = pages[0].map((o) => o.text).join("");
		expect(texts).toContain(visualOrder('לוח לימוד יומי - אלול ה\'תשפה - תנ"ך על הפרק'));
	});

	it("renders a 12-month year as cover plus six two-month pages", async () => {
		const months = getMonthOrderForYear().map((ref) =>
			fakeMonth(getMonthLabel(ref), monthCells, ref),
		);
		const pdf = await generateCalendarPdf(
			fakeInput(months, { scope: "year", title: "year-doc" }),
		);
		const pages = await extractTextOps(pdf);
		expect(pages).toHaveLength(7);
		// Cover: logo + title, no calendar grids.
		expect(await pageDrawsImage(pdf, 0)).toBe(true);
		expect(
			pages[0].map((o) => o.text).filter((t) => t === "ןושאר"),
		).toHaveLength(0);
		// Data pages: exactly two monthly calendars (two weekday rows).
		for (let i = 1; i < pages.length; i++) {
			expect(
				pages[i].map((o) => o.text).filter((t) => t === "ןושאר"),
			).toHaveLength(2);
		}
	});

	it("leaves the odd final month alone on the last page", async () => {
		const months = getMonthOrderForYear(5784).map((ref) =>
			fakeMonth(getMonthLabel(ref), monthCells, ref),
		);
		// 5784 is a leap year — 13 uniform months.
		expect(months).toHaveLength(13);
		const pdf = await generateCalendarPdf(
			fakeInput(months, { scope: "year", title: "year-doc" }),
		);
		const pages = await extractTextOps(pdf);
		expect(pages).toHaveLength(8);
		for (let i = 1; i < pages.length - 1; i++) {
			expect(
				pages[i].map((o) => o.text).filter((t) => t === "ןושאר"),
			).toHaveLength(2);
		}
		// Odd final month alone — exactly one weekday row.
		expect(
			pages[7].map((o) => o.text).filter((t) => t === "ןושאר"),
		).toHaveLength(1);
	});

	it("renders a cycle as cover plus paired month pages", async () => {
		const months = [
			getCycleStartMonthLabel(),
			fakeMonth("כסלו", monthCells, { year: 5786, month: 3 }),
			fakeMonth("טבת", monthCells, { year: 5786, month: 4 }),
		];
		const pdf = await generateCalendarPdf(
			fakeInput(months, {
				scope: "cycle",
				title: "לוח לימוד יומי - מחזור 4 - תנ\"ך על הפרק",
				subtitle: "כ״ה אדר ה'תשפ״ה - כ״ד אדר ה'תשצ״ו",
			}),
		);
		const pages = await extractTextOps(pdf);
		expect(pages).toHaveLength(3); // cover + pair + single
		expect(await pageDrawsImage(pdf, 0)).toBe(true);
	});

	it("numbers every page inside the footer band", async () => {
		const months = getMonthOrderForYear()
			.slice(0, 4)
			.map((ref) => fakeMonth(getMonthLabel(ref), monthCells, ref));
		const pdf = await generateCalendarPdf(
			fakeInput(months, { scope: "year", title: "year-doc" }),
		);
		const pages = await extractTextOps(pdf);
		expect(pages).toHaveLength(3); // cover + 2 data pages
		for (let i = 0; i < pages.length; i++) {
			const footer = opsAtY(pages[i], 11).map((o) => o.text);
			expect(footer).toContain(String(i + 1));
		}
	});
});

/** Uniform month refs for a year (defaults to the common 12-month year). */
function getMonthOrderForYear(year = 5785): MonthRef[] {
	return getMonthOrder(year).map((month) => ({ year, month }));
}

describe("per-page range headings (#2727)", () => {
	const monthCells = cellsForDays([STUDY]);

	async function dataPageHeading(months: CalendarPdfMonth[]): Promise<string> {
		const pdf = await generateCalendarPdf(
			fakeInput(months, { scope: "year", title: "doc" }),
		);
		const pages = await extractTextOps(pdf);
		// The range heading is the bold line between the header rule and the
		// first month title — baseline y=752 in the data-page layout.
		return opsAtY(pages[1], 752)
			.map((o) => o.text)
			.join("");
	}

	it("joins same-year months once followed by the year", async () => {
		const months = [
			fakeMonth("חשוון", monthCells, { year: 5785, month: 2 }),
			fakeMonth("כסלו", monthCells, { year: 5785, month: 3 }),
		];
		const heading = await dataPageHeading(months);
		expect(heading).toBe(visualOrder("חשוון-כסלו ה'תשפ\"ה"));
	});

	it("spells both years on an אלול to תשרי crossing", async () => {
		const months = [
			fakeMonth("אלול", monthCells, { year: 5785, month: 12 }),
			fakeMonth("תשרי", monthCells, { year: 5786, month: 1 }),
		];
		const heading = await dataPageHeading(months);
		expect(heading).toBe(visualOrder("אלול ה'תשפ\"ה - תשרי ה'תשפ\"ו"));
	});

	it("labels a leap-year אדר א / אדר ב pair", async () => {
		const months = [
			fakeMonth("אדר א", monthCells, { year: 5784, month: 13 }),
			fakeMonth("אדר ב", monthCells, { year: 5784, month: 14 }),
		];
		const heading = await dataPageHeading(months);
		expect(heading).toBe(visualOrder("אדר א׳-אדר ב׳ ה'תשפ\"ד"));
	});

	it("uses the lone month's own label on the final single-month page", async () => {
		const months = [
			fakeMonth("חשוון", monthCells, { year: 5785, month: 2 }),
			fakeMonth("כסלו", monthCells, { year: 5785, month: 3 }),
			fakeMonth("טבת", monthCells, { year: 5785, month: 4 }),
		];
		const pdf = await generateCalendarPdf(
			fakeInput(months, { scope: "year", title: "doc" }),
		);
		const pages = await extractTextOps(pdf);
		const lastPage = pages[2].map((o) => o.text).join("");
		expect(lastPage).toContain(visualOrder("טבת ה'תשפ\"ה"));
	});
});

describe("chapter link annotations (#2727)", () => {
	const LINK_BASE = `${SITE_ORIGIN}/929`;

	async function linksFor(input: CalendarPdfInput): Promise<LinkAnnot[][]> {
		return extractLinkAnnots(await generateCalendarPdf(input));
	}

	it("links a scheduled study-day source to its canonical perek page", async () => {
		const study = scheduleDay({ day: 10, perekId: 45, dayOfWeek: 1 });
		const pages = await linksFor(
			fakeInput([fakeMonth("אלול", cellsForDays([study]))], {
				linkBase: LINK_BASE,
				dayLabel: (day) => getPerekSource(day.perekId ?? 1),
			}),
		);
		expect(pages).toHaveLength(1);
		expect(pages[0]).toHaveLength(1);
		expect(pages[0][0].uri).toBe(`${LINK_BASE}/45`);
		// Rect sits inside the page over the label area.
		expect(pages[0][0].rect[0]).toBeGreaterThan(0);
		expect(pages[0][0].rect[2]).toBeLessThan(595);
		expect(pages[0][0].rect[1]).toBeLessThan(pages[0][0].rect[3]);
	});

	it("adds no link to review, blank or unscheduled cells", async () => {
		const review = scheduleDay({
			day: 5,
			status: "review",
			perekId: 7,
			reviewPerekIds: [5, 6, 7],
		});
		const pages = await linksFor(
			fakeInput([fakeMonth("אלול", cellsForDays([review, UNNUMBERED]))], {
				linkBase: LINK_BASE,
				dayLabel: (day) => getPerekSource(day.perekId ?? 1),
			}),
		);
		expect(pages[0]).toHaveLength(0);
	});

	it("adds no link to a dimmed study day", async () => {
		const study = scheduleDay({ day: 10, perekId: 45 });
		const pages = await linksFor(
			fakeInput([fakeMonth("אלול", cellsForDays([study]))], {
				linkBase: LINK_BASE,
				dimmed: () => true,
				dayLabel: (day) => getPerekSource(day.perekId ?? 1),
			}),
		);
		expect(pages[0]).toHaveLength(0);
	});

	it("renders without annotations when linkBase is omitted", async () => {
		const study = scheduleDay({ day: 10, perekId: 45 });
		const pages = await linksFor(
			fakeInput([fakeMonth("אלול", cellsForDays([study]))], {
				dayLabel: (day) => getPerekSource(day.perekId ?? 1),
			}),
		);
		expect(pages[0]).toHaveLength(0);
	});

	it("bounds each link to its own label across a two-month page", async () => {
		const studyA = scheduleDay({ day: 3, perekId: 10, dayOfWeek: 1 });
		const studyB = scheduleDay({ day: 4, perekId: 20, dayOfWeek: 2 });
		const months = [
			fakeMonth("חשוון", cellsForDays([studyA]), { year: 5785, month: 2 }),
			fakeMonth("כסלו", cellsForDays([studyB]), { year: 5785, month: 3 }),
		];
		const pages = await linksFor(
			fakeInput(months, {
				scope: "year",
				linkBase: LINK_BASE,
				dayLabel: (day) => getPerekSource(day.perekId ?? 1),
			}),
		);
		expect(pages[1]).toHaveLength(2);
		const uris = pages[1].map((a) => a.uri).sort();
		expect(uris).toEqual([`${LINK_BASE}/10`, `${LINK_BASE}/20`]);
		// The two rects sit at different positions — each over its own cell.
		const [a, b] = pages[1].map((l) => l.rect[1]);
		expect(Math.abs(a - b)).toBeGreaterThan(20);
	});
});

describe("calendar PDF text stays searchable", () => {
	it("maps every drawn glyph to Unicode via ToUnicode CMaps", async () => {
		const pages = await generateAndExtract(
			fakeInput([fakeMonth("אלול", cellsForDays([STUDY]))], {
				subtitle: "מחזור 4",
			}),
		);
		const ops = pages[0].filter((o) => o.codes.length > 0);
		expect(ops.length).toBeGreaterThan(0);
		for (const op of ops) {
			// Every code resolves to a real codepoint — no notdef/tofu mapping.
			expect(op.text.length).toBeGreaterThan(0);
		}
		// The title's letters are all extractable (searchable), in visual order.
		const title = pages[0].find((o) => o.text.includes("ימוי"));
		expect(title).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: asserted defined above
		expect([...title!.text].sort()).toEqual([..."ימוי דומיל חול"].sort());
	});
});

describe("layout edge cases (#2608)", () => {
	it("truncates an over-wide day label to the cell width", async () => {
		// fitText keeps the longest prefix that still fits CELL_W - 6.
		const longLabel = "בראשית א ב ג ד ה ו ז ח ט י יא יב יג יד טו טז";
		const pages = await generateAndExtract(
			fakeInput([fakeMonth("אלול", cellsForDays([STUDY]))], {
				dayLabel: () => longLabel,
			}),
		);
		const full = visualOrder(longLabel);
		const texts = pages[0].map((o) => o.text);
		expect(texts).not.toContain(full);
		// Pure-Hebrew visual order reverses the string, so the surviving
		// logical prefix lands as a suffix of the fully-rendered form.
		expect(
			texts.some(
				(t) => t.length > 1 && t.length < full.length && full.endsWith(t),
			),
		).toBe(true);
	});

	it("dims days flagged by the dimmed predicate and skips their labels", async () => {
		const pages = await generateAndExtract(
			fakeInput([fakeMonth("אלול", cellsForDays([STUDY, REVIEW]))], {
				dimmed: (day) => day.day === 2,
				dayLabel: (day) =>
					day.status === "review" && day.reviewPerekIds
						? `${getPerekSource(day.reviewPerekIds[0])} - ${getPerekSource(day.reviewPerekIds[day.reviewPerekIds.length - 1])}`
						: getPerekSource(day.perekId ?? 1),
			}),
		);
		const texts = pages[0].map((o) => o.text).join("");
		// The study day's perek label still renders…
		expect(texts).toContain("א תישארב");
		// …but the dimmed review day's range label is skipped entirely.
		expect(texts).not.toContain("ז תישארב - ג תישארב");
	});
});

describe("deterministic output (#2608)", () => {
	afterEach(() => {
		jest.useRealTimers();
	});

	it("produces byte-identical PDFs regardless of wall-clock time", async () => {
		// The artifact pipeline content-addresses objects by sha256 — the
		// render must not embed CreationDate/ModDate or any other timestamp.
		const input: CalendarPdfInput = fakeInput(
			[fakeMonth("אלול", cellsForDays([STUDY, REVIEW]))],
			{
				subtitle: "מחזור 4",
				linkBase: `${SITE_ORIGIN}/929`,
				dayLabel: () => "א",
			},
		);
		jest.useFakeTimers().setSystemTime(new Date("2026-01-01T00:00:00Z"));
		const first = await generateCalendarPdf(input);
		jest.setSystemTime(new Date("2031-06-15T12:34:56Z"));
		const second = await generateCalendarPdf(input);
		expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
	});
});
