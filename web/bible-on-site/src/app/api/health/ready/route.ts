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

type ContentRow = { authorCount: number; articleCount: number };
// `reported` dedupes failure logging across checks that shared the query.
type ContentResult = { rows: ContentRow[] } | { error: unknown; reported?: boolean };

type ReadinessResult =
	| {
			status: "ready";
			warmed: boolean;
			content: ContentRow;
	  }
	| { status: "error"; message: string };

let inflight: Promise<ReadinessResult> | undefined;
let pendingContent: Promise<ContentResult> | undefined;

// One outstanding content query at a time across checks: a probe that failed
// fast while the query was still running must not let the next probe pile
// another query onto a stalled pool. Once it settles the next probe verifies
// the database afresh.
function contentQuery(): Promise<ContentResult> {
	pendingContent ??= query<ContentRow>(
		`SELECT /*+ MAX_EXECUTION_TIME(1000) */
		 COUNT(DISTINCT a.author_id) AS authorCount, COUNT(*) AS articleCount
		 FROM tanah_article a JOIN tanah_author au ON au.id = a.author_id
		 WHERE a.perek_id BETWEEN 1 AND 929`,
	)
		.then((rows): ContentResult => ({ rows }))
		.catch((error: unknown): ContentResult => ({ error }))
		.finally(() => {
			pendingContent = undefined;
		});
	return pendingContent;
}

async function checkReadiness(): Promise<ReadinessResult> {
	// Fire the content query first: its pool setup and round trip overlap the
	// synchronous warm below instead of serializing after it.
	const contentReady = contentQuery();
	try {
		warmCriticalPaths();
		recitationResponse();
		// Page renders and the database check are independent gates; await both
		// together so whichever is slower is the only tail left.
		const [content] = await Promise.all([contentReady, warmServerPages()]);
		if ("error" in content) throw content.error;
		const [row] = content.rows;
		if (!row || row.authorCount < 1 || row.articleCount < 1) {
			throw new Error("Public authors and articles are unavailable");
		}
		return { status: "ready", warmed: isWarmed, content: row };
	} catch (error) {
		// A synchronous warm throw can outrun the overlapped query — or the
		// query can outrun this failure. Report it when it settles instead of
		// awaiting it here: the 503 must never stall behind the database.
		void contentReady.then((result) => {
			if ("error" in result && !result.reported) {
				result.reported = true;
				if (result.error !== error) {
					console.error(
						"Concurrent content readiness failure:",
						result.error,
					);
				}
			}
		});
		console.error("Readiness check failed:", error);
		return {
			status: "error",
			message: error instanceof Error ? error.message : "Unknown error",
		};
	}
}

export async function GET(): Promise<NextResponse> {
	// The launcher's early probe and the scheduled container check can overlap
	// during startup: share the in-flight check so the warm runs once, then let
	// the next probe re-verify the database as before.
	inflight ??= checkReadiness().finally(() => {
		inflight = undefined;
	});
	const result = await inflight;
	return NextResponse.json(result, {
		status: result.status === "ready" ? 200 : 503,
	});
}
