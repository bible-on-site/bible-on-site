import { type NextRequest, NextResponse } from "next/server";
// Subpath import required for Next.js Edge runtime compatibility
import RateLimiterMemory from "rate-limiter-flexible/lib/RateLimiterMemory.js";

const BLOCKED_BOTS =
	/Bytespider|MJ12bot|AhrefsBot|SemrushBot|DotBot|PetalBot|BLEXBot|MegaIndex|Sogou/i;

const limiter = new RateLimiterMemory({
	points: 30,
	duration: 60,
});

function getClientIp(request: NextRequest): string {
	return (
		request.headers.get("x-real-ip") ??
		request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
		"unknown"
	);
}

export async function middleware(
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

	const ip = getClientIp(request);

	try {
		const res = await limiter.consume(ip);
		const response = NextResponse.next();
		response.headers.set(
			"X-RateLimit-Remaining",
			res.remainingPoints.toString(),
		);
		return response;
	} catch {
		return new NextResponse("Too Many Requests", {
			status: 429,
			headers: { "Retry-After": "60" },
		});
	}
}

export const config = {
	matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
