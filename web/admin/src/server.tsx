import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import {
	buildClearSessionCookie,
	buildSessionCookie,
	exchangeCodeForTokens,
	getLoginUrl,
	getLogoutUrl,
	parseCookie,
	verifyIdToken,
} from "./server/auth";

const SKIP_AUTH = process.env.SKIP_AUTH === "true";

function firstHeaderValue(value: string | null): string | null {
	if (!value) return null;
	return value.split(",")[0]?.trim() || null;
}

function resolveRequestOrigin(request: Request): {
	origin: string;
	isSecure: boolean;
} {
	const url = new URL(request.url);
	const forwardedProto = firstHeaderValue(
		request.headers.get("x-forwarded-proto"),
	);
	const forwardedHost = firstHeaderValue(
		request.headers.get("x-forwarded-host"),
	);
	const hostHeader = firstHeaderValue(request.headers.get("host"));

	const protocol =
		forwardedProto === "https" || forwardedProto === "http"
			? forwardedProto
			: url.protocol.replace(":", "");
	const host = forwardedHost || hostHeader || url.host;

	return {
		origin: `${protocol}://${host}`,
		isSecure: protocol === "https",
	};
}

export default createServerEntry({
	async fetch(request) {
		if (SKIP_AUTH) {
			return handler.fetch(request);
		}

		const url = new URL(request.url);
		const { origin, isSecure } = resolveRequestOrigin(request);

		if (url.pathname === "/auth/callback") {
			return handleCallback(url, origin, isSecure);
		}

		if (url.pathname === "/auth/logout") {
			return handleLogout(origin);
		}

		const cookieHeader = request.headers.get("cookie") || "";
		const sessionToken = parseCookie(cookieHeader, "admin_session");

		if (!sessionToken || !(await verifyIdToken(sessionToken))) {
			return Response.redirect(getLoginUrl(origin), 302);
		}

		return handler.fetch(request);
	},
});

async function handleCallback(
	url: URL,
	origin: string,
	isSecure: boolean,
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
		return new Response(null, {
			status: 302,
			headers: {
				Location: "/",
				"Set-Cookie": cookie,
			},
		});
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
