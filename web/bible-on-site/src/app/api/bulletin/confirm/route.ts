import { NextResponse } from "next/server";
import { confirmSignup } from "@/lib/bulletin-signup";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** Reads the token from JSON or a no-JS form post; nothing else. */
async function readToken(
	request: Request,
): Promise<{ token: unknown; formPost: boolean }> {
	const type = (request.headers.get("content-type") ?? "").split(";")[0];
	if (type === "application/json") {
		try {
			const body = await request.json();
			return {
				token: (body as Record<string, unknown> | null)?.token,
				formPost: false,
			};
		} catch {
			return { token: undefined, formPost: false };
		}
	}
	if (type === "application/x-www-form-urlencoded") {
		try {
			const data = await request.formData();
			return { token: data.get("token"), formPost: true };
		} catch {
			return { token: undefined, formPost: true };
		}
	}
	return { token: undefined, formPost: false };
}

const STATUS_FOR = {
	confirmed: 200,
	expired: 410,
	invalid: 404,
} as const;

/**
 * POST /api/bulletin/confirm — consumes a mailed confirmation challenge.
 *
 * Confirmation is a POST-only mutation so mail scanners and prefetchers that
 * only issue GET/HEAD requests never confirm an address. Re-confirming the
 * same link is a successful no-op (see confirmSignup). The JSON contract is
 * `{status: "confirmed" | "expired" | "invalid"}`; form posts are redirected
 * back to the confirmation page without carrying the token along.
 */
export async function POST(request: Request) {
	const { token, formPost } = await readToken(request);
	let outcome: keyof typeof STATUS_FOR;
	try {
		outcome = await confirmSignup(typeof token === "string" ? token : "");
	} catch {
		console.error("Bulletin signup confirm failed");
		if (formPost) {
			return NextResponse.redirect(
				new URL("/join/email/confirm?outcome=error", request.url),
				303,
			);
		}
		return NextResponse.json(
			{ error: "Confirm unavailable" },
			{ status: 503, headers: NO_STORE },
		);
	}
	if (formPost) {
		return NextResponse.redirect(
			new URL(`/join/email/confirm?outcome=${outcome}`, request.url),
			303,
		);
	}
	return NextResponse.json(
		{ status: outcome },
		{ status: STATUS_FOR[outcome], headers: NO_STORE },
	);
}
