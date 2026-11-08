/**
 * Unit tests for the shared bidi drawing helpers (#2620).
 *
 * `visualTextRuns` resolves a logical string into directional runs in
 * visual order. RTL runs keep logical order in `text` — fontkit's layout
 * pipeline reverses their glyphs during encode — with mirrored brackets
 * swapped so the reversal lands the right shapes.
 */
import type { PDFFont, PDFHexString, PDFPage } from "pdf-lib";
import {
	bidiTextWidth,
	drawBidiText,
	memoizeGlyphEncoding,
	visualTextRuns,
} from "../../../src/lib/download/bidi-text";

const mockFont = {
	widthOfTextAtSize: jest.fn((text: string) => text.length * 10),
} as unknown as PDFFont;

describe("visualTextRuns", () => {
	it("returns a single RTL run for pure Hebrew", () => {
		expect(visualTextRuns("שלום עולם")).toEqual([
			{ text: "שלום עולם", rtl: true },
		]);
	});

	it("returns a single LTR run for pure Latin", () => {
		expect(visualTextRuns("hello world")).toEqual([
			{ text: "hello world", rtl: false },
		]);
	});

	it("returns an empty array for empty text", () => {
		expect(visualTextRuns("")).toEqual([]);
	});

	it("splits digits out of RTL text in visual order", () => {
		// "מחזור 4" → visual "4 רוזחמ": the Hebrew run (logical) is drawn
		// rightmost; the digit run leftmost.
		expect(visualTextRuns("מחזור 4")).toEqual([
			{ text: "4", rtl: false },
			{ text: "מחזור ", rtl: true },
		]);
	});

	it("keeps multi-digit numbers intact", () => {
		const runs = visualTextRuns("מחזור 12 עד 3");
		// The digit runs stay in digit order — never reversed to "21".
		const digits = runs.filter((r) => !r.rtl).map((r) => r.text);
		expect(digits).toEqual(["3", "12"]);
	});

	it("splits a trailing Latin word into its own LTR run", () => {
		const runs = visualTextRuns("שלום test");
		expect(runs[0]).toEqual({ text: "test", rtl: false });
		expect(runs[1]).toEqual({ text: "שלום ", rtl: true });
	});

	it("mirrors brackets inside RTL runs", () => {
		expect(visualTextRuns("(עולם)")).toEqual([
			{ text: ")עולם(", rtl: true },
		]);
	});

	it("keeps hyphen and colon inside an RTL run", () => {
		expect(visualTextRuns("בראשית ג - בראשית ז")).toEqual([
			{ text: "בראשית ג - בראשית ז", rtl: true },
		]);
		expect(visualTextRuns("מאת: הרב כהן")).toEqual([
			{ text: "מאת: הרב כהן", rtl: true },
		]);
	});

	it("orders a complex mixed string across many runs", () => {
		// "מחזור 12: שלום (עולם) test" → visual "test (םלוע) םולש :12 רוזחמ"
		const runs = visualTextRuns("מחזור 12: שלום (עולם) test");
		expect(runs).toEqual([
			{ text: "test", rtl: false },
			{ text: ": שלום )עולם( ", rtl: true },
			{ text: "12", rtl: false },
			{ text: "מחזור ", rtl: true },
		]);
	});
});

describe("bidiTextWidth", () => {
	it("sums the width of every visual run", () => {
		// "מחזור 4" → runs "4" (10) + "מחזור " (60) = 70
		expect(bidiTextWidth(mockFont, "מחזור 4", 6)).toBe(70);
	});

	it("returns 0 for empty text", () => {
		expect(bidiTextWidth(mockFont, "", 6)).toBe(0);
	});
});

describe("drawBidiText", () => {
	function fakePage() {
		const calls: [string, { x: number }][] = [];
		const page = {
			drawText: jest.fn((text: string, opts: { x: number }) => {
				calls.push([text, opts]);
			}),
		} as unknown as PDFPage;
		return { page, calls };
	}

	it("draws each run left-to-right at consecutive x offsets", () => {
		const { page, calls } = fakePage();
		drawBidiText(page, "מחזור 4", mockFont, 6, 100, 700, {} as never);
		// Visual order: "4" at x=100, then "מחזור " at x=110 (width 10).
		expect(calls).toEqual([
			["4", expect.objectContaining({ x: 100 })],
			["מחזור ", expect.objectContaining({ x: 110 })],
		]);
	});

	it("draws nothing for empty text", () => {
		const { page, calls } = fakePage();
		drawBidiText(page, "", mockFont, 6, 100, 700, {} as never);
		expect(calls).toEqual([]);
	});

	it("passes font, size, y and color through to drawText", () => {
		const { page, calls } = fakePage();
		const color = { r: 1, g: 0, b: 0 } as never;
		drawBidiText(page, "שלום", mockFont, 12, 50, 500, color);
		expect(calls[0][1]).toMatchObject({
			y: 500,
			size: 12,
			font: mockFont,
			color,
		});
	});
});

describe("memoizeGlyphEncoding", () => {
	function fontWithEncode() {
		const encodeText = jest.fn(
			(text: string) => ({ hex: text }) as unknown as PDFHexString,
		);
		const font = {
			encodeText,
			widthOfTextAtSize: jest.fn(() => 10),
		} as unknown as PDFFont;
		return { font, encodeText };
	}

	it("returns the cached encoding for repeated text", () => {
		const { font, encodeText } = fontWithEncode();
		memoizeGlyphEncoding(font);
		const first = font.encodeText("שלום");
		expect(font.encodeText("שלום")).toBe(first);
		expect(encodeText).toHaveBeenCalledTimes(1);
		font.encodeText("עולם");
		expect(encodeText).toHaveBeenCalledTimes(2);
	});

	it("is idempotent — wrapping twice keeps one cache", () => {
		const { font, encodeText } = fontWithEncode();
		memoizeGlyphEncoding(font);
		memoizeGlyphEncoding(font);
		font.encodeText("א");
		font.encodeText("א");
		expect(encodeText).toHaveBeenCalledTimes(1);
	});

	it("passes fonts without encodeText through untouched", () => {
		const font = { widthOfTextAtSize: jest.fn() } as unknown as PDFFont;
		expect(memoizeGlyphEncoding(font)).toBe(font);
	});
});
