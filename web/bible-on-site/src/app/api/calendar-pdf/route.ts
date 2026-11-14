import { NextResponse } from "next/server";
import { canExportCalendarPeriod } from "@/data/learning-calendar-policy";
import { assetsUrl } from "@/lib/assets-url";
import {
	parseCalendarArtifactKey,
	resolveCalendarArtifactRequest,
} from "@/lib/download/calendar-artifacts";
import { getCalendarPdfManifest } from "@/lib/download/calendar-pdf-manifest";
import { getCurrentDate } from "@/util/date";
import { constructTsetAwareHDate } from "@/util/hebdates-util";

export const dynamic = "force-dynamic";

/**
 * Legacy entrypoint for the learning-calendar PDFs (#2608).
 *
 * Rendering no longer runs on the request path — generation stalled sibling
 * requests for seconds on the production 0.25-CPU task. All supported
 * month/year/cycle exports are pre-generated and published to the public S3
 * assets bucket under content-addressed keys; this route resolves the query
 * to its canonical artifact and redirects to it.
 *
 * Semantics preserved: the same month/view/cycle params select the same
 * document and download filename (the object carries Content-Disposition);
 * HEAD rides along via the redirect. What changed: there is deliberately no
 * inline-render fallback — a missing manifest yields 503 and a valid request
 * outside the generated bounds yields 404 instead of burning request time on
 * an unbounded date space.
 */
export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const resolved = resolveCalendarArtifactRequest(searchParams);
	if (!resolved.ok) {
		return NextResponse.json({ error: resolved.error }, { status: 400 });
	}
	const period = parseCalendarArtifactKey(resolved.key);
	if (
		!period ||
		!canExportCalendarPeriod(period, constructTsetAwareHDate(getCurrentDate()))
	) {
		return NextResponse.json(
			{ error: "calendar PDF is outside the current export window" },
			{ status: 404 },
		);
	}

	const manifest = await getCalendarPdfManifest();
	if (manifest === null) {
		return NextResponse.json(
			{ error: "calendar artifacts manifest unavailable" },
			{ status: 503, headers: { "Retry-After": "30" } },
		);
	}

	const artifact = manifest.artifacts[resolved.key];
	if (artifact !== undefined) {
		return NextResponse.redirect(assetsUrl(artifact.object), 302);
	}

	// Inside the generated bounds the artifact should exist — a gap means the
	// manifest predates the publish or an object failed verification, which is
	// retryable. Out-of-bounds (past/future dates beyond the generated set) is
	// a permanent 404 — never an inline render.
	if (resolved.inBounds) {
		return NextResponse.json(
			{ error: "calendar artifact not yet published" },
			{ status: 503, headers: { "Retry-After": "30" } },
		);
	}
	return NextResponse.json(
		{ error: "calendar artifact out of generated range" },
		{ status: 404 },
	);
}
