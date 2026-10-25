import { NextResponse } from "next/server";
import {
	getResponseTime,
	isResponseTimeMonitor,
	responseTimeExpiresAt,
} from "@/lib/response-time";

export const dynamic = "force-dynamic";

/** Mean remote-probe TTFB over the rolling 60 minutes before the current UTC minute. */
export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ monitor: string }> },
): Promise<NextResponse> {
	const { monitor } = await params;
	if (!isResponseTimeMonitor(monitor)) {
		return NextResponse.json(
			{ error: "Unknown monitor" },
			{
				status: 404,
				headers: { "Cache-Control": "no-store" },
			},
		);
	}
	const snapshot = await getResponseTime(monitor);
	const remaining = snapshot ? responseTimeExpiresAt(snapshot) - Date.now() : 0;
	if (remaining <= 0) {
		return NextResponse.json(
			{ error: "Response-time measurement unavailable" },
			{
				status: 503,
				headers: { "Cache-Control": "no-store", "Retry-After": "60" },
			},
		);
	}
	// A cached snapshot's HTTP lifetime ends with its original cache entry;
	// repeated requests must not extend that measurement's freshness window.
	const maxAge = Math.floor(remaining / 1000);
	return NextResponse.json(snapshot, {
		headers: {
			"Cache-Control": `public, max-age=${maxAge}, s-maxage=${maxAge}, must-revalidate`,
		},
	});
}
