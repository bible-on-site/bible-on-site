import { NextResponse } from "next/server";
import { isJoinChannel, resolveJoinDestination } from "@/lib/bulletin-join";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
/** Fallback join hub when a channel has no configured destination. */
const JOIN_HUB = "/dailyBulletin";

function redirectTo(request: Request, location: string): NextResponse {
	const url = new URL(location, request.url);
	return new NextResponse(null, {
		status: 307,
		headers: { ...NO_STORE, location: url.toString() },
	});
}

async function respond(
	request: Request,
	channel: string,
): Promise<NextResponse> {
	if (!isJoinChannel(channel)) {
		return new NextResponse("Not found", {
			status: 404,
			headers: NO_STORE,
		});
	}
	let destination: string | null;
	try {
		destination = await resolveJoinDestination(channel);
	} catch {
		// A persistence failure is treated like a missing destination: the
		// stable route still lands visitors on the bulletin join section.
		console.error("Bulletin join destination lookup failed");
		destination = null;
	}
	// The channel destinations are expected to always be configured; when one
	// is not, send the visitor to the bulletin join hub instead of a dead-end
	// error page (review on #3083).
	if (destination === null) return redirectTo(request, JOIN_HUB);
	return redirectTo(request, destination);
}

type Props = { params: Promise<{ channel: string }> };

export async function GET(request: Request, { params }: Props) {
	return respond(request, (await params).channel);
}

export async function HEAD(request: Request, { params }: Props) {
	return respond(request, (await params).channel);
}
