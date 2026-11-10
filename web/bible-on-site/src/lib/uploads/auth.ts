import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
	CognitoIdentityProviderClient,
	GetUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { createRemoteJWKSet, errors, type JWTPayload, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { isUploadId, UploadError } from "../../../../shared/private-upload";

export const SESSION_COOKIE = "upload_session";
export const REFRESH_COOKIE = "upload_refresh";
export const FLOW_COOKIE = "upload_login";
export const privateHeaders = {
	"Cache-Control": "private, no-store, max-age=0",
	"X-Robots-Tag": "noindex, nofollow, noarchive",
	"Referrer-Policy": "no-referrer",
	"X-Content-Type-Options": "nosniff",
};

export function authConfig() {
	const region = process.env.UPLOAD_AWS_REGION || "il-central-1";
	const pool = process.env.UPLOAD_COGNITO_POOL_ID;
	const clientId = process.env.UPLOAD_COGNITO_CLIENT_ID;
	const domain = process.env.UPLOAD_COGNITO_DOMAIN;
	const origin = process.env.UPLOAD_ORIGIN;
	if (!pool || !clientId || !domain || !origin)
		throw new UploadError("אזור ההעלאה עדיין אינו זמין", 503);
	return {
		region,
		pool,
		clientId,
		domain,
		origin,
		issuer: `https://cognito-idp.${region}.amazonaws.com/${pool}`,
	};
}

export function cookieOptions(maxAge: number) {
	return {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax" as const,
		path: "/upload",
		maxAge,
	};
}

const keysets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function currentUploadUser() {
	const jar = await cookies();
	let token = jar.get(SESSION_COOKIE)?.value;
	const refresh = jar.get(REFRESH_COOKIE)?.value;
	if (!token && !refresh) return null;
	const config = authConfig();
	try {
		let keys = keysets.get(config.issuer);
		if (!keys) {
			keys = createRemoteJWKSet(
				new URL(`${config.issuer}/.well-known/jwks.json`),
			);
			keysets.set(config.issuer, keys);
		}
		let payload: JWTPayload;
		try {
			if (!token) throw new errors.JWTExpired("Session expired", {});
			({ payload } = await jwtVerify(token, keys, { issuer: config.issuer }));
		} catch (error) {
			if (!(error instanceof errors.JWTExpired) || !refresh) throw error;
			const response = await fetch(`https://${config.domain}/oauth2/token`, {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					grant_type: "refresh_token",
					client_id: config.clientId,
					refresh_token: refresh,
				}),
				cache: "no-store",
			});
			if (!response.ok) return null;
			const data = await response.json();
			if (
				typeof data.access_token !== "string" ||
				typeof data.expires_in !== "number"
			)
				return null;
			token = data.access_token;
			({ payload } = await jwtVerify(token as string, keys, {
				issuer: config.issuer,
			}));
			jar.set(
				SESSION_COOKIE,
				token as string,
				cookieOptions(Math.min(data.expires_in, 3600)),
			);
		}
		if (
			payload.token_use !== "access" ||
			payload.client_id !== config.clientId ||
			!payload.sub ||
			!isUploadId(payload.sub)
		)
			return null;
		// Cognito checks account disablement and token revocation on every request.
		const user = await new CognitoIdentityProviderClient({
			region: config.region,
		}).send(new GetUserCommand({ AccessToken: token }));
		if (
			user.UserAttributes?.find((attribute) => attribute.Name === "sub")
				?.Value !== payload.sub
		)
			return null;
		return { id: payload.sub, username: user.Username || payload.sub };
	} catch (error) {
		if (
			error instanceof Error &&
			["NotAuthorizedException", "UserNotFoundException"].includes(error.name)
		)
			return null;
		if (error instanceof errors.JOSEError) return null;
		throw new UploadError("לא ניתן לאמת את הכניסה כרגע", 503);
	}
}

export function loginFlow() {
	const config = authConfig();
	const state = randomBytes(32).toString("base64url");
	const verifier = randomBytes(32).toString("base64url");
	const params = new URLSearchParams({
		response_type: "code",
		client_id: config.clientId,
		redirect_uri: `${config.origin}/upload/auth/callback`,
		scope: "openid aws.cognito.signin.user.admin",
		state,
		code_challenge_method: "S256",
		code_challenge: createHash("sha256").update(verifier).digest("base64url"),
	});
	return {
		url: `https://${config.domain}/oauth2/authorize?${params}`,
		cookie: JSON.stringify({ state, verifier }),
	};
}

export function verifyState(expected: string, actual: string) {
	const a = Buffer.from(expected);
	const b = Buffer.from(actual);
	return a.length === b.length && timingSafeEqual(a, b);
}

export function requireUploadOrigin(request: Request) {
	if (request.headers.get("origin") !== authConfig().origin)
		throw new UploadError("בקשה אינה מורשית", 403);
}
