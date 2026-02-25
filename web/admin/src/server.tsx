import handler, {
	createServerEntry,
} from "@tanstack/react-start/server-entry";
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

export default createServerEntry({
	async fetch(request) {
		if (SKIP_AUTH) {
			return handler.fetch(request);
		}

		const url = new URL(request.url);
		const origin = `${url.protocol}//${url.host}`;
		const isSecure = url.protocol === "https:";

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
