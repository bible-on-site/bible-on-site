import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { confirmSignup, isChallengeToken } from "@/lib/bulletin-signup";
import { CONFIRM_TOKEN_COOKIE } from "@/lib/bulletin-signup/shared";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const CONFIRM_PAGE = "/join/email/confirm";
/** Narrowest scope that still reaches the confirm POST. */
const COOKIE_OPTIONS = {
	httpOnly: true,
	sameSite: "strict",
	secure: process.env.NODE_ENV === "production",
	path: "/api/bulletin",
} as const;

/**
 * GET /api/bulletin/confirm?t= — the mailed link's landing hop. Moves the
 * challenge into an HttpOnly cookie and redirects to a token-free page URL,
 * so the live token never appears in rendered page data, the DOM, history,
 * or client-readable state. Idempotent: it only stages the challenge; the
 * consume stays POST-only so mail scanners cannot confirm an address.
 */
export async function GET(request: Request) {
	const token = new URL(request.url).searchParams.get("t");
	const response = NextResponse.redirect(
		new URL(CONFIRM_PAGE, request.url),
		303,
	);
	if (isChallengeToken(token))
		response.cookies.set(CONFIRM_TOKEN_COOKIE, token, COOKIE_OPTIONS);
	return response;
}

/**
 * Reads the token from JSON, a no-JS form post, or the staged cookie — in
 * that precedence, so an explicit body still wins for API callers.
 */
async function readToken(
	request: Request,
): Promise<{ token: unknown; formPost: boolean }> {
	const stored = (await cookies()).get(CONFIRM_TOKEN_COOKIE)?.value;
	const type = (request.headers.get("content-type") ?? "").split(";")[0];
	if (type === "application/json") {
		try {
			const body = await request.json();
			return {
				token: (body as Record<string, unknown> | null)?.token ?? stored,
				formPost: false,
			};
		} catch {
			return { token: stored, formPost: false };
		}
	}
	if (type === "application/x-www-form-urlencoded") {
		try {
			const data = await request.formData();
			return { token: data.get("token") ?? stored, formPost: true };
		} catch {
			return { token: stored, formPost: true };
		}
	}
	return { token: stored, formPost: false };
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
 * back to the confirmation page without carrying the token along. A resolved
 * outcome clears the staged cookie.
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
				new URL(`${CONFIRM_PAGE}?outcome=error`, request.url),
				303,
			);
		}
		return NextResponse.json(
			{ error: "Confirm unavailable" },
			{ status: 503, headers: NO_STORE },
		);
	}
	if (formPost) {
		const response = NextResponse.redirect(
			new URL(`${CONFIRM_PAGE}?outcome=${outcome}`, request.url),
			303,
		);
		response.cookies.delete({
			name: CONFIRM_TOKEN_COOKIE,
			path: COOKIE_OPTIONS.path,
		});
		return response;
	}
	const response = NextResponse.json(
		{ status: outcome },
		{ status: STATUS_FOR[outcome], headers: NO_STORE },
	);
	response.cookies.delete({
		name: CONFIRM_TOKEN_COOKIE,
		path: COOKIE_OPTIONS.path,
	});
	return response;
}
