import { type NextRequest, NextResponse } from "next/server";

const BLOCKED_BOTS =
	/Bytespider|MJ12bot|AhrefsBot|SemrushBot|DotBot|PetalBot|BLEXBot|MegaIndex|Sogou/i;

export async function proxy(
	request: NextRequest,
): Promise<NextResponse | undefined> {
	const { pathname } = request.nextUrl;

	if (
		pathname.startsWith("/api/health") ||
		pathname.startsWith("/_next/") ||
		pathname.startsWith("/favicon") ||
		/\.(css|js|png|jpg|svg|ico|woff2?)$/.test(pathname)
	) {
		return undefined;
	}

	const ua = request.headers.get("user-agent") ?? "";

	if (BLOCKED_BOTS.test(ua)) {
		return new NextResponse("Forbidden", { status: 403 });
	}

	return undefined;
}

export const config = {
	matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
