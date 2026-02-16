/**
 * Client for the bulletin PDF generation service (web/bulletin).
 *
 * Instead of generating PDFs client-side with pdf-lib (fragile for Hebrew),
 * this module calls the Rust-based bulletin service which produces
 * high-quality PDFs with proper RTL/nikud handling.
 */

import { getPerekByPerekId } from "@/data/perek-dto";
import type { SemanticPageInfo } from "./types";
import { semanticPagesToPerekIds, segmentsToText, stripTaamim } from "./tanach-pdf";

const BULLETIN_URL =
	process.env.BULLETIN_URL ?? "http://localhost:3004";

/** Shape expected by the bulletin service. */
interface BulletinRequest {
	seferName: string;
	perakim: {
		perekId: number;
		perekHeb: string;
		header: string;
		pesukim: string[];
	}[];
	includePerushim: boolean;
	includeArticles: boolean;
	articleIds: number[];
	authorIds: number[];
}

/**
 * Call the bulletin service to generate a PDF for the given perek IDs.
 * Returns raw PDF bytes.
 */
export async function generatePdfViaBulletin(
	perekIds: number[],
	seferName: string,
): Promise<Uint8Array> {
	// Build request payload with text content from bundled data
	const perakim = perekIds.map((id) => {
		const perek = getPerekByPerekId(id);
		return {
			perekId: id,
			perekHeb: perek.perekHeb,
			header: perek.header ?? "",
			pesukim: perek.pesukim.map((p) =>
				stripTaamim(segmentsToText(p.segments)),
			),
		};
	});

	const body: BulletinRequest = {
		seferName,
		perakim,
		includePerushim: false, // TODO: enable when perushim API is ready in bulletin
		includeArticles: true,
		articleIds: [],
		authorIds: [],
	};

	const response = await fetch(`${BULLETIN_URL}/api/generate-pdf`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		const text = await response.text().catch(() => "unknown error");
		throw new Error(
			`Bulletin service error ${response.status}: ${text}`,
		);
	}

	const arrayBuffer = await response.arrayBuffer();
	return new Uint8Array(arrayBuffer);
}

/**
 * Create a page-ranges download handler that calls the bulletin service.
 * Drop-in replacement for the pdf-lib based handler.
 */
export function createBulletinPageRangesHandler(): (
	pages: number[],
	semanticPages: SemanticPageInfo[],
	context?: { seferName?: string },
) => Promise<[ext: string, bin: Uint8Array]> {
	return async (_pages, semanticPages, context) => {
		const seferName = context?.seferName;
		if (!seferName) {
			throw new Error("Tanach PDF requires context.seferName");
		}

		const perekIds = semanticPagesToPerekIds(semanticPages, seferName);
		if (perekIds.length === 0) {
			throw new Error("No content pages in selected range");
		}

		const bin = await generatePdfViaBulletin(perekIds, seferName);
		return ["pdf", bin];
	};
}
