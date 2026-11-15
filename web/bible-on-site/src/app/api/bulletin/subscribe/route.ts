import { NextResponse } from "next/server";
import {
	MAX_JSON_BODY_BYTES,
	readBoundedJson,
} from "@/lib/bounded-json";
import { parseSignupBody, requestSignup } from "@/lib/bulletin-signup";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * POST /api/bulletin/subscribe — public daily-bulletin email signup.
 *
 * Always answers 202 with the same generic acknowledgement so the endpoint
 * cannot enumerate subscriptions or expose throttling; the durable intent
 * decides whether the address is actually subscribed.
 */
export async function POST(request: Request) {
	// JSON only; the bounded reader enforces the size cap while streaming,
	// so an untruthful or missing Content-Length cannot buffer an unbounded
	// body.
	const json =
		(request.headers.get("content-type") ?? "").split(";")[0] ===
		"application/json"
			? await readBoundedJson(request, MAX_JSON_BODY_BYTES)
			: null;
	const parsed = parseSignupBody(
		json?.status === "parsed" ? json.value : null,
	);
	if (parsed === null) {
		return NextResponse.json(
			{ error: "Invalid request" },
			{ status: 400, headers: NO_STORE },
		);
	}
	try {
		await requestSignup(parsed);
	} catch {
		// Do not echo the email back or log it — addresses stay out of logs.
		console.error("Bulletin signup request failed");
		return NextResponse.json(
			{ error: "Signup unavailable" },
			{ status: 503, headers: NO_STORE },
		);
	}
	return NextResponse.json(
		{ status: "received" },
		{ status: 202, headers: NO_STORE },
	);
}
