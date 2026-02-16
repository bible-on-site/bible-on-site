/**
 * Basic Tanach PDF extraction per perek range.
 * Builds a PDF from perek text (vocalized) for the given perek IDs.
 *
 * Uses the embedded Heebo variable font so Hebrew characters render correctly.
 * pdf-lib's StandardFonts only support WinAnsi (Latin-1) encoding — any
 * non-Latin text (Hebrew, Arabic, etc.) requires an embedded custom font.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import * as fontkit from "@pdf-lib/fontkit";
import type { Segment } from "@/data/db/tanah-view-types";
import { getPerekByPerekId } from "@/data/perek-dto";
import { getPerekIdsForSefer, getSeferByName } from "@/data/sefer-dto";

/** Lazily loaded font bytes (singleton). */
let hebrewFontBytes: Uint8Array | null = null;

function getHebrewFontBytes(): Uint8Array {
	if (!hebrewFontBytes) {
		// In Next.js, __dirname may point to .next/server/ at runtime.
		// Use process.cwd() which is always the project root.
		const fontPath = resolve(
			process.cwd(),
			"src",
			"lib",
			"download",
			"fonts",
			"Heebo-Regular.ttf",
		);
		hebrewFontBytes = readFileSync(fontPath);
	}
	return hebrewFontBytes;
}

/** Get plain text from segments (qri/ktiv only; stuma/ptuha as space). */
function segmentsToText(segments: Segment[]): string {
	return segments
		.map((s) => {
			if (s.type === "qri" || s.type === "ktiv") return s.value;
			return " ";
		})
		.join("")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Naive word-wrap: split text into lines that fit within maxWidth.
 * pdf-lib's `maxWidth` option on drawText doesn't work reliably with
 * custom embedded fonts, so we measure and break manually.
 */
function wrapText(
	text: string,
	font: { widthOfTextAtSize: (t: string, s: number) => number },
	fontSize: number,
	maxWidth: number,
): string[] {
	if (!text) return [""];
	const words = text.split(/\s+/);
	const lines: string[] = [];
	let current = "";

	for (const word of words) {
		const test = current ? `${current} ${word}` : word;
		if (font.widthOfTextAtSize(test, fontSize) <= maxWidth) {
			current = test;
		} else {
			if (current) lines.push(current);
			current = word;
		}
	}
	if (current) lines.push(current);
	return lines.length ? lines : [""];
}

/** Build PDF bytes for the given perek IDs. */
export async function buildTanachPdfForPerekRange(
	perekIds: number[],
): Promise<Uint8Array> {
	const doc = await PDFDocument.create();

	// Register fontkit so pdf-lib can embed OpenType/TrueType fonts
	doc.registerFontkit(fontkit);

	const fontBytes = getHebrewFontBytes();
	const font = await doc.embedFont(fontBytes, { subset: true });

	const fontSize = 12;
	const titleSize = 16;
	const lineHeight = fontSize * 1.6;
	const titleLineHeight = titleSize * 1.8;
	const margin = 50;
	const pageWidth = 595;
	const pageHeight = 842;
	const maxWidth = pageWidth - 2 * margin;
	doc.addPage([pageWidth, pageHeight]);
	let y = pageHeight - margin;

	for (const perekId of perekIds) {
		const perek = getPerekByPerekId(perekId);
		const title = `${perek.sefer} ${perek.perekHeb}`;
		const header = perek.header;

		// ── Title ──
		{
			if (y < margin + titleLineHeight * 3) {
				doc.addPage([pageWidth, pageHeight]);
				y = pageHeight - margin;
			}
			const titleWidth = font.widthOfTextAtSize(title, titleSize);
			const titleX = pageWidth - margin - titleWidth; // RTL: right-align
			const pages = doc.getPages();
			const page = pages[pages.length - 1];
			page.drawText(title, {
				x: Math.max(margin, titleX),
				y,
				size: titleSize,
				font,
				color: rgb(0, 0, 0),
			});
			y -= titleLineHeight;

			if (header) {
				const hdrWidth = font.widthOfTextAtSize(header, fontSize);
				const hdrX = pageWidth - margin - hdrWidth;
				page.drawText(header, {
					x: Math.max(margin, hdrX),
					y,
					size: fontSize,
					font,
					color: rgb(0.3, 0.3, 0.3),
				});
				y -= lineHeight;
			}
			y -= lineHeight * 0.5; // spacing after header
		}

		// ── Pesukim ──
		for (const pasuk of perek.pesukim) {
			const text = segmentsToText(pasuk.segments);
			if (!text) continue;
			const wrapped = wrapText(text, font, fontSize, maxWidth);
			for (const line of wrapped) {
				if (y < margin + lineHeight) {
					doc.addPage([pageWidth, pageHeight]);
					y = pageHeight - margin;
				}
				const pages = doc.getPages();
				const page = pages[pages.length - 1];
				const lineWidth = font.widthOfTextAtSize(line, fontSize);
				const lineX = pageWidth - margin - lineWidth; // RTL: right-align
				page.drawText(line, {
					x: Math.max(margin, lineX),
					y,
					size: fontSize,
					font,
					color: rgb(0, 0, 0),
				});
				y -= lineHeight;
			}
		}
		y -= lineHeight; // spacing between perakim
	}

	return doc.save();
}

/**
 * Map flipbook page indices to perek IDs for a sefer.
 * Assumes layout: page 0 = cover, 1 = perek 1, 2 = blank, 3 = perek 2, ...
 */
function pageIndicesToPerekIds(
	pageIndices: number[],
	seferName: string,
): number[] {
	const sefer = getSeferByName(seferName);
	const perekIds = getPerekIdsForSefer(sefer);
	const result: number[] = [];
	for (const p of pageIndices) {
		if (p <= 0 || p % 2 === 0) continue; // cover or blank
		const perekIdx = (p - 1) / 2;
		const id = perekIds[perekIdx];
		if (perekIdx >= 0 && id !== undefined) {
			result.push(id);
		}
	}
	return result;
}

/**
 * Create a page-ranges download handler that produces a Tanach PDF for the selected pages.
 * Requires context.seferName to resolve page indices to perakim.
 */
export function createTanachPageRangesHandler(): (
	pages: number[],
	_semanticPages: { pageIndex: number }[],
	context?: { seferName?: string },
) => Promise<[ext: string, bin: Uint8Array]> {
	return async (pages, _semanticPages, context) => {
		const seferName = context?.seferName;
		if (!seferName) {
			throw new Error("Tanach PDF requires context.seferName");
		}
		const perekIds = pageIndicesToPerekIds(pages, seferName);
		if (perekIds.length === 0) {
			throw new Error("No content pages in selected range");
		}
		const bin = await buildTanachPdfForPerekRange(perekIds);
		return ["pdf", bin];
	};
}
