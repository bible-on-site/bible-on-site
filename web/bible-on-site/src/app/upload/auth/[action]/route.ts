import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
	authConfig,
	cookieOptions,
	FLOW_COOKIE,
	loginFlow,
	privateHeaders,
	REFRESH_COOKIE,
	SESSION_COOKIE,
	verifyState,
} from "@/lib/uploads/auth";

export async function GET(
	request: Request,
	context: { params: Promise<{ action: string }> },
) {
	const jar = await cookies();
	const { action } = await context.params;
	try {
		if (action === "login") {
			const flow = loginFlow();
			const response = NextResponse.redirect(flow.url);
			response.cookies.set(FLOW_COOKIE, flow.cookie, cookieOptions(600));
			for (const [key, value] of Object.entries(privateHeaders))
				response.headers.set(key, value);
			return response;
		}
		if (action !== "callback")
			return new Response(null, { status: 404, headers: privateHeaders });
		const flow = JSON.parse(jar.get(FLOW_COOKIE)?.value || "null") as {
			state: string;
			verifier: string;
		} | null;
		jar.set(FLOW_COOKIE, "", cookieOptions(0));
		const url = new URL(request.url);
		const state = url.searchParams.get("state");
		const code = url.searchParams.get("code");
		if (!flow || !state || !code || !verifyState(flow.state, state))
			return new Response("הכניסה לא אומתה. יש לנסות שוב.", {
				status: 400,
				headers: privateHeaders,
			});
		const config = authConfig();
		const tokens = await fetch(`https://${config.domain}/oauth2/token`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "authorization_code",
				client_id: config.clientId,
				redirect_uri: `${config.origin}/upload/auth/callback`,
				code,
				code_verifier: flow.verifier,
			}),
			cache: "no-store",
		});
		if (!tokens.ok) throw new Error("Token exchange rejected");
		const data = await tokens.json();
		if (
			typeof data.access_token !== "string" ||
			typeof data.expires_in !== "number"
		)
			throw new Error("Invalid token response");
		const response = NextResponse.redirect(`${config.origin}/upload`);
		response.cookies.set(
			SESSION_COOKIE,
			data.access_token,
			cookieOptions(Math.min(data.expires_in, 3600)),
		);
		if (typeof data.refresh_token === "string")
			response.cookies.set(
				REFRESH_COOKIE,
				data.refresh_token,
				cookieOptions(86400),
			);
		for (const [key, value] of Object.entries(privateHeaders))
			response.headers.set(key, value);
		return response;
	} catch {
		return new Response("הכניסה נכשלה. יש לנסות שוב.", {
			status: 503,
			headers: privateHeaders,
		});
	}
}
