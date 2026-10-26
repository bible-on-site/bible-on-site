/**
 * @jest-environment node
 *
 * Visual bidi regression for the learning-calendar PDF (issue #2620).
 *
 * Generates a real PDF with the production Frank Ruhl fonts and inspects
 * the emitted content stream: every text-show op's glyph codes are decoded
 * back to Unicode through the embedded ToUnicode CMap. The decoded sequence
 * is the visual order a renderer paints — it must equal the bidi-reordered
 * (UAX #9) form of the logical string, which for pure Hebrew is a plain
 * character reversal.
 *
 * Before the fix, `reverseGraphemes` pre-reversed text while fontkit also
 * reverses RTL glyph runs during layout, so the stream held logical order —
 * every label painted backwards.
 */

import bidiFactory from "bidi-js";
import {
	decodePDFRawStream,
	PDFArray,
	PDFDict,
	PDFDocument,
	PDFName,
	PDFRawStream,
} from "pdf-lib";
import {
	buildMonth,
	type CalendarDay,
	getCycle,
	getCycleLabel,
	getMonthLabel,
	getPerekSource,
	type MonthCell,
} from "@/data/learning-schedule";
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
		const pages = await generateAndExtract({
			title: "לוח לימוד יומי",
			months: [{ title: "אלול ה'תשפה", cells: cellsForDays([STUDY]) }],
			dayLabel: () => "",
		});
		const texts = pages[0].map((o) => o.text);
		// Visual order of "לוח לימוד יומי" is "ימוי דומיל חול".
		expect(texts).toContain("ימוי דומיל חול");
	});

	it("draws weekday labels in visual order, not logical order", async () => {
		const pages = await generateAndExtract({
			title: "לוח",
			months: [{ title: "אלול", cells: cellsForDays([STUDY]) }],
			dayLabel: () => "",
		});
		const texts = pages[0].map((o) => o.text);
		expect(texts).toContain("ישילש"); // שלישי
		expect(texts).toContain("ןושאר"); // ראשון
		expect(texts).toContain("תבש"); // שבת
		expect(texts).not.toContain("שלישי");
	});

	it("draws multi-letter Hebrew day numbers in visual order", async () => {
		const pages = await generateAndExtract({
			title: "לוח",
			months: [{ title: "אלול", cells: cellsForDays([UNNUMBERED]) }],
			dayLabel: () => "",
		});
		const texts = pages[0].map((o) => o.text);
		// Day 14 → toLetters(14, addQuotes) = 'י"ד' → visual 'ד"י'.
		expect(texts).toContain('ד"י');
	});

	it("draws perek sources and review ranges in visual order", async () => {
		const pages = await generateAndExtract({
			title: "לוח",
			months: [{ title: "אלול", cells: cellsForDays([STUDY, REVIEW]) }],
			dayLabel: (day) =>
				day.status === "review" && day.reviewPerekIds
					? `${getPerekSource(day.reviewPerekIds[0])} - ${getPerekSource(day.reviewPerekIds[day.reviewPerekIds.length - 1])}`
					: getPerekSource(day.perekId ?? 1),
		});
		const texts = pages[0].map((o) => o.text).join("");
		// "בראשית א" → visual "א תישארב".
		expect(texts).toContain("א תישארב");
		// Review range "בראשית ג - בראשית ז" → visual "ז תישארב - ג תישארב".
		expect(texts).toContain("ז תישארב - ג תישארב");
	});

	it("keeps digits and Latin tokens un-reversed inside RTL text", async () => {
		const subtitle = "מחזור 12: שלב א (בדיקה) end";
		const pages = await generateAndExtract({
			title: "לוח",
			subtitle,
			months: [{ title: "אלול", cells: cellsForDays([STUDY]) }],
			dayLabel: () => "",
		});
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
		const pages = await generateAndExtract({
			title: "לוח לימוד יומי",
			subtitle,
			months: [{ title: "אלול", cells: cellsForDays([STUDY]) }],
			dayLabel: () => "",
		});
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
		const pages = await generateAndExtract({
			title: "לוח לימוד יומי",
			subtitle: getCycleLabel(getCycle(4)),
			months: [month],
			dayLabel: (day) => getPerekSource(day.perekId ?? 1),
		});
		const texts = pages[0].map((o) => o.text).join("");
		expect(texts).toContain("ימוי דומיל חול");
		expect(texts).toContain(visualOrder(month.title));
	});
});

function getCycleStartMonthLabel(): CalendarPdfMonth {
	const cycle = getCycle(4);
	const ref = {
		year: cycle.start.year,
		month: cycle.start.getUniformMonth(),
	};
	return { title: getMonthLabel(ref), cells: buildMonth(ref.year, ref.month) };
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
		const pages = await generateAndExtract({
			title: "לוח",
			months: [{ title: "אלול", cells: cellsForDays(pair) }],
			dayLabel: (day) => getPerekSource(day.perekId ?? 1),
		});
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
		): CalendarPdfInput => ({
			title: "לוח",
			months: [{ title: "אלול", cells: cellsForDays(pair) }],
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
		const pages = await generateAndExtract({
			title: "לוח",
			months: [{ title: "אלול", cells: cellsForDays(mismatched) }],
			dayLabel: (day) => getPerekSource(day.perekId ?? 1),
		});
		const texts = pages[0].map((o) => o.text).join("");
		expect(texts).toContain(visualOrder('י"ב'));
		expect(texts).toContain(visualOrder('י"ג'));
		expect(texts).not.toContain(visualOrder('י"ב - י"ג'));
	});
});

describe("calendar PDF text stays searchable", () => {
	it("maps every drawn glyph to Unicode via ToUnicode CMaps", async () => {
		const pages = await generateAndExtract({
			title: "לוח לימוד יומי",
			subtitle: "מחזור 4",
			months: [{ title: "אלול", cells: cellsForDays([STUDY]) }],
			dayLabel: () => "",
		});
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
