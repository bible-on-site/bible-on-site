import { NextResponse } from "next/server";
import { parseSignupBody, requestSignup } from "@/lib/bulletin-signup";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4 * 1024;
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * JSON only, small, and forgiving about an absent Content-Length. The size
 * cap is enforced while streaming, so an untruthful or missing
 * Content-Length cannot make the server buffer an unbounded body.
 */
async function readBody(request: Request): Promise<unknown> {
	if (
		(request.headers.get("content-type") ?? "").split(";")[0] !==
		"application/json"
	)
		return null;
	const declared = Number(request.headers.get("content-length") ?? "0");
	if (declared > MAX_BODY_BYTES) return null;
	const reader = request.body?.getReader();
	if (!reader) return null;
	const decoder = new TextDecoder();
	let text = "";
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			text += decoder.decode();
			break;
		}
		size += value.byteLength;
		if (size > MAX_BODY_BYTES) {
			await reader.cancel();
			return null;
		}
		text += decoder.decode(value, { stream: true });
	}
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/**
 * POST /api/bulletin/subscribe — public daily-bulletin email signup.
 *
 * Always answers 202 with the same generic acknowledgement so the endpoint
 * cannot enumerate subscriptions or expose throttling; the durable intent
 * decides whether the address is actually subscribed.
 */
export async function POST(request: Request) {
	const parsed = parseSignupBody(await readBody(request));
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
