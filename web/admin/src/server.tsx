import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { SESSION_EXPIRED_PREFIX } from "./lib/server-fn-errors";
import {
	buildClearSessionCookie,
	buildSessionCookie,
	exchangeCodeForTokens,
	getLoginUrl,
	getLogoutUrl,
	parseCookie,
	verifyIdToken,
	verifyServiceAccessToken,
} from "./server/auth";
import { rescanDedicationExpiries } from "./server/dedication-expiry";
import { ensureEmailWorkerStarted } from "./server/email-worker-runtime.server";
import {
	measureCovEnabled,
	skipAuthEnabled,
} from "./server/environment.server";

// Local dev/test escape hatch only — fails closed in production (#3069).
const SKIP_AUTH = skipAuthEnabled();

// Boot catch-up for expiry-instant invalidations (#2731): arms timers for
// future dedication expiries and flushes ones that elapsed while the admin
// was down. Skipped when the website endpoint is not configured — every
// flush would no-op on the same check anyway.
if (process.env.VITE_WEBSITE_URL && process.env.REVALIDATE_SECRET) {
	void rescanDedicationExpiries().catch((error) =>
		console.error("dedication expiry rescan failed:", error),
	);
}

function firstHeaderValue(value: string | null): string | null {
	if (!value) return null;
	return value.split(",")[0]?.trim() || null;
}

function resolveRequestOrigin(request: Request): {
	origin: string;
	isSecure: boolean;
} {
	const url = new URL(request.url);
	// Trust X-Forwarded-Proto: our nginx reverse proxy explicitly sets it
	// (proxy_set_header X-Forwarded-Proto https;) for every server block.
	const forwardedProto = firstHeaderValue(
		request.headers.get("x-forwarded-proto"),
	);
	// Do NOT trust X-Forwarded-Host: nginx does not set/overwrite it, so a
	// client could spoof it directly. Use the Host header instead - nginx
	// explicitly forwards it (proxy_set_header Host $host;) and it is only
	// reachable in the first place via the matching server_name/SNI, so it
	// reflects the domain the client actually connected to.
	const hostHeader = firstHeaderValue(request.headers.get("host"));

	const protocol =
		forwardedProto === "https" || forwardedProto === "http"
			? forwardedProto
			: url.protocol.replace(":", "");
	const host = hostHeader || url.host;

	return {
		origin: `${protocol}://${host}`,
		isSecure: protocol === "https",
	};
}

export default createServerEntry({
	async fetch(request) {
		await ensureEmailWorkerStarted();
		const url = new URL(request.url);
		const { origin, isSecure } = resolveRequestOrigin(request);

		// Native archivers enter only this explicit HTTP surface. They never reach
		// TanStack server functions, which continue to require the admin SSO client.
		if (
			url.pathname === "/archive/api" ||
			url.pathname.startsWith("/archive/auth/")
		) {
			const { handleArchiveRequest } = await import("./server/archive/http");
			return handleArchiveRequest(request, origin);
		}
		if (url.pathname === "/archive" || url.pathname.startsWith("/archive/")) {
			if (
				request.headers.has("x-tsr-serverFn") ||
				!["GET", "HEAD"].includes(request.method)
			)
				return new Response(null, { status: 405 });
			const response = await handler.fetch(request);
			const headers = new Headers(response.headers);
			headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
			headers.set("Cache-Control", "private, no-store, max-age=0");
			return new Response(response.body, { status: response.status, headers });
		}

		// E2E coverage drain: instrumented SSR modules write istanbul coverage to
		// this realm's globalThis; the Playwright fixture fetches it per test.
		if (measureCovEnabled() && url.pathname === "/api/dev/coverage") {
			const g = globalThis as { __coverage__?: unknown };
			const coverage = g.__coverage__ ?? {};
			g.__coverage__ = {};
			return Response.json(coverage);
		}

		if (SKIP_AUTH) {
			return handler.fetch(request);
		}

		if (url.pathname === "/auth/callback") {
			return handleCallback(url, origin, isSecure, request);
		}

		if (url.pathname === "/auth/logout") {
			return handleLogout(origin);
		}

		// M2M path: automated scripts authenticate with a Cognito client_credentials
		// access token instead of the browser cookie session. Purely additive - falls
		// through to the existing cookie check below when absent/invalid.
		const authHeader = firstHeaderValue(request.headers.get("authorization"));
		const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i);
		const bearerToken = bearerMatch?.[1]?.trim();
		if (bearerToken && (await verifyServiceAccessToken(bearerToken))) {
			return handler.fetch(request);
		}

		const cookieHeader = request.headers.get("cookie") || "";
		const sessionToken = parseCookie(cookieHeader, "admin_session");

		if (!sessionToken || !(await verifyIdToken(sessionToken))) {
			if (
				parseCookie(cookieHeader, "archive_session") ||
				parseCookie(cookieHeader, "archive_refresh")
			)
				return new Response("אין הרשאה לאזור הניהול", {
					status: 403,
					headers: { "Cache-Control": "no-store" },
				});
			// Server-fn calls cannot follow the Cognito redirect (cross-origin
			// fetch rejects); a plain 401 gives them a throwable response.
			if (request.headers.get("x-tsr-serverFn") === "true") {
				return new Response(
					`${SESSION_EXPIRED_PREFIX}: admin session expired`,
					{ status: 401 },
				);
			}
			return Response.redirect(getLoginUrl(origin), 302);
		}

		return handler.fetch(request);
	},
});

async function handleCallback(
	url: URL,
	origin: string,
	isSecure: boolean,
	request: Request,
): Promise<Response> {
	const code = url.searchParams.get("code");
	if (!code) {
		return new Response("Missing authorization code", { status: 400 });
	}

	try {
		const tokens = await exchangeCodeForTokens(code, origin);
		const cookie = buildSessionCookie(
			tokens.id_token,
			tokens.expires_in,
			isSecure,
		);
		const returnToArchive =
			parseCookie(
				request.headers.get("cookie") || "",
				"archive_admin_return",
			) === "1";
		const response = new Response(null, {
			status: 302,
			headers: {
				Location: returnToArchive ? "/archive" : "/",
				"Set-Cookie": cookie,
			},
		});
		if (returnToArchive)
			response.headers.append(
				"Set-Cookie",
				`archive_admin_return=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${isSecure ? "; Secure" : ""}`,
			);
		return response;
	} catch (error) {
		console.error("Auth callback error:", error);
		return new Response("Authentication failed", { status: 500 });
	}
}

function handleLogout(origin: string): Response {
	const cookie = buildClearSessionCookie();
	return new Response(null, {
		status: 302,
		headers: {
			Location: getLogoutUrl(origin),
			"Set-Cookie": cookie,
		},
	});
}
