import DOMPurify from "isomorphic-dompurify";
import { NextResponse } from "next/server";
import { getPerekByPerekId } from "@/data/perek-dto";
import { query } from "@/lib/api-client";
import { recitationResponse } from "@/lib/recitation-response";
import { getPasukIndex, getPerekIndex } from "@/lib/search/corpus";
import { warmServerPages } from "@/lib/server-page-readiness";

export const dynamic = "force-dynamic";

/**
 * ECS readiness probe. Importing perek-dto initializes the canonical server data
 * shared by chapter and recitation routes; the sample lookups verify it is usable.
 * Prepare the full validated recitation body before admitting public traffic.
 * Load the server HTML sanitizer here too: its first JSDOM/CSS-parser load is
 * synchronous and otherwise blocks unrelated requests on the first SSR page.
 * Build the process-shared chapter and verse search indexes before admission.
 * Liveness can pass before this cold load completes, so ECS must use this endpoint
 * before replacing the old task. Public articles and their authors must also
 * be available. Bulletin approval is independent of website visibility.
 */

let isWarmed = false;

function warmCriticalPaths(): void {
	if (isWarmed) return;

	// Warm the perek data loading path (loads sefarim, perakim data)
	// This ensures the data modules are loaded and cached
	getPerekByPerekId(1);
	getPerekByPerekId(929);

	if (DOMPurify.sanitize("<p>ready</p>") !== "<p>ready</p>") {
		throw new Error("HTML sanitizer is unavailable");
	}
	getPerekIndex();
	getPasukIndex();

	isWarmed = true;
}

export async function GET(): Promise<NextResponse> {
	try {
		warmCriticalPaths();
		recitationResponse();
		const [content] = await query<{
			authorCount: number;
			articleCount: number;
		}>(
			`SELECT /*+ MAX_EXECUTION_TIME(1000) */
			 COUNT(DISTINCT a.author_id) AS authorCount, COUNT(*) AS articleCount
			 FROM tanah_article a JOIN tanah_author au ON au.id = a.author_id
			 WHERE a.perek_id BETWEEN 1 AND 929`,
		);
		if (!content || content.authorCount < 1 || content.articleCount < 1) {
			throw new Error("Public authors and articles are unavailable");
		}
		await warmServerPages();
		return NextResponse.json(
			{
				status: "ready",
				warmed: isWarmed,
				content,
			},
			{ status: 200 },
		);
	} catch (error) {
		console.error("Readiness check failed:", error);
		return NextResponse.json(
			{
				status: "error",
				message: error instanceof Error ? error.message : "Unknown error",
			},
			{ status: 503 },
		);
	}
}
