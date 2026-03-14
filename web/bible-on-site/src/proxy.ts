import { type NextRequest, NextResponse } from "next/server";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { isProduction } from "@/util/environment";

const BLOCKED_BOTS =
	/Bytespider|MJ12bot|AhrefsBot|SemrushBot|DotBot|PetalBot|BLEXBot|MegaIndex|Sogou/i;

const limiter = new RateLimiterMemory({
	points: 30,
	duration: 60,
});

function getClientIp(request: NextRequest): string | null {
	const realIp = request.headers.get("x-real-ip");
	if (realIp) return realIp;

	const forwarded = request.headers.get("x-forwarded-for");
	if (forwarded) {
		const first = forwarded.split(",")[0]?.trim();
		if (first) return first;
	}

	return null;
}

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

	if (!isProduction()) {
		return NextResponse.next();
	}

	const ip = getClientIp(request);

	if (!ip) {
		return NextResponse.next();
	}

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
