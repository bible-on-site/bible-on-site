/**
 * Basic Tanach PDF extraction per perek range.
 * Builds a PDF from perek text (vocalized) for the given perek IDs.
 */

import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { Segment } from "@/data/db/tanah-view-types";
import { getPerekByPerekId } from "@/data/perek-dto";
import { getPerekIdsForSefer, getSeferByName } from "@/data/sefer-dto";

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

/** Build PDF bytes for the given perek IDs. */
export async function buildTanachPdfForPerekRange(
	perekIds: number[],
): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	const font = await doc.embedFont(StandardFonts.Helvetica);
	const fontSize = 11;
	const lineHeight = fontSize * 1.4;
	const margin = 50;
	const pageWidth = 595;
	const pageHeight = 842;
	const maxWidth = pageWidth - 2 * margin;
	doc.addPage([pageWidth, pageHeight]);
	let y = pageHeight - margin;

	for (const perekId of perekIds) {
		const perek = getPerekByPerekId(perekId);
		const lines = [`${perek.sefer} ${perek.perekHeb}`, perek.header, ""];
		for (const pasuk of perek.pesukim) {
			lines.push(segmentsToText(pasuk.segments));
		}
		for (const line of lines) {
			// Simple wrap by character (Hebrew-friendly would need a proper text measure)
			const chunks = line.length ? [line] : [""];
			for (const chunk of chunks) {
				if (y < margin + lineHeight) {
					doc.addPage([pageWidth, pageHeight]);
					y = pageHeight - margin;
				}
				const page = doc.getPages().at(-1);
				if (page) {
					page.drawText(chunk, {
						x: margin,
						y,
						size: fontSize,
						font,
						color: rgb(0, 0, 0),
						maxWidth,
					});
				}
				y -= lineHeight;
			}
		}
		y -= lineHeight;
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
