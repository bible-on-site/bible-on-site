import { describe, expect, it } from "vitest";
import {
	FOOTNOTE_INSERT_MARKER,
	bumpFootnoteNumbersFrom,
	listFootnoteIndices,
	maxFootnoteIndex,
	prepareHtmlForNewFootnoteAtSlot,
	resyncFootnoteRefLettersFromHtml,
} from "./adminFootnoteHtml";

describe("adminFootnoteHtml", () => {
	describe("maxFootnoteIndex", () => {
		it("returns 0 for empty or no notes", () => {
			expect(maxFootnoteIndex("")).toBe(0);
			expect(maxFootnoteIndex("<p>hello</p>")).toBe(0);
		});

		it("reads href, note id, and noteref id", () => {
			const html = `<p><a href="#note-3" id="noteref-3">ג</a></p><p id="note-7">x</p>`;
			expect(maxFootnoteIndex(html)).toBe(7);
		});

		it("supports single-quoted id attributes", () => {
			expect(maxFootnoteIndex(`<p id='note-4'>y</p>`)).toBe(4);
		});
	});

	describe("listFootnoteIndices", () => {
		it("returns sorted unique indices", () => {
			const html = `<a href="#note-2"></a><p id="note-1"></p><a href="#note-2"></a>`;
			expect(listFootnoteIndices(html)).toEqual([1, 2]);
		});
	});

	describe("bumpFootnoteNumbersFrom", () => {
		it("shifts note-2 and note-3 when inserting at slot 2", () => {
			const html = `<p><a href="#note-1" id="noteref-1">א</a> <a href="#note-2" id="noteref-2">ב</a></p><p id="note-2">ב.</p>`;
			const bumped = bumpFootnoteNumbersFrom(html, 2);
			expect(bumped).toContain('href="#note-3"');
			expect(bumped).toContain('id="noteref-3"');
			expect(bumped).toContain('id="note-3"');
			expect(bumped).toContain('href="#note-1"');
			expect(bumped).not.toContain('href="#note-2"');
		});

		it("handles two-digit indices without collision", () => {
			const html = `<a href="#note-9" id="noteref-9"></a><a href="#note-10" id="noteref-10"></a>`;
			const bumped = bumpFootnoteNumbersFrom(html, 9);
			expect(bumped).toContain('href="#note-11"');
			expect(bumped).toContain('href="#note-10"');
			expect(bumped).not.toContain('href="#note-9"');
		});

		it("returns unchanged when fromN > max", () => {
			const html = `<a href="#note-1"></a>`;
			expect(bumpFootnoteNumbersFrom(html, 5)).toBe(html);
		});

		it("preserves insert marker text", () => {
			const html = `<p>טקסט ${FOOTNOTE_INSERT_MARKER} סוף</p><a href="#note-1"></a>`;
			const bumped = bumpFootnoteNumbersFrom(html, 1);
			expect(bumped).toContain(FOOTNOTE_INSERT_MARKER);
			expect(bumped).toContain('href="#note-2"');
		});
	});

	describe("resyncFootnoteRefLettersFromHtml", () => {
		it("rewrites inner text from href number", () => {
			const html = `<a href="#note-2" id="noteref-2">WRONG</a>`;
			expect(resyncFootnoteRefLettersFromHtml(html)).toContain(">ב<");
		});
	});

	describe("prepareHtmlForNewFootnoteAtSlot", () => {
		it("bumps and resyncs letters for middle insert", () => {
			const html = `<p><a href="#note-1" id="noteref-1">א</a> <a href="#note-2" id="noteref-2">ב</a></p>`;
			const out = prepareHtmlForNewFootnoteAtSlot(html, 2);
			expect(out).toContain('href="#note-3"');
			expect(out).toMatch(/>ג<\/a>/);
			expect(out).toContain('href="#note-1"');
		});

		it("allows append slot max+1 without bump", () => {
			const html = `<a href="#note-1" id="noteref-1">א</a>`;
			const out = prepareHtmlForNewFootnoteAtSlot(html, 2);
			expect(out).toBe(resyncFootnoteRefLettersFromHtml(html));
		});

		it("throws when slot out of range", () => {
			expect(() => prepareHtmlForNewFootnoteAtSlot(`<a href="#note-1"></a>`, 3)).toThrow(
				RangeError,
			);
		});
	});
});
