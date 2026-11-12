import "@tanstack/react-start/server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
	CognitoIdentityProviderClient,
	GetUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { createRemoteJWKSet, errors, type JWTPayload, jwtVerify } from "jose";
import { type ArchiveUser, isUploadId, UploadError } from "../../lib/archive";
import {
	parseCookie,
	verifyIdTokenClaims,
	verifyServiceAccessToken,
} from "../auth";
import { skipAuthEnabled } from "../environment.server";

export const SESSION_COOKIE = "archive_session";
export const REFRESH_COOKIE = "archive_refresh";
export const FLOW_COOKIE = "archive_login";
export const privateHeaders = {
	"Cache-Control": "private, no-store, max-age=0",
	"X-Robots-Tag": "noindex, nofollow, noarchive",
	"Referrer-Policy": "no-referrer",
	"X-Content-Type-Options": "nosniff",
};

export function authConfig() {
	const region = process.env.ARCHIVE_AWS_REGION || "il-central-1";
	const pool = process.env.ARCHIVE_COGNITO_POOL_ID;
	const clientId = process.env.ARCHIVE_COGNITO_CLIENT_ID;
	const domain = process.env.ARCHIVE_COGNITO_DOMAIN;
	const origin = process.env.ARCHIVE_ORIGIN;
	if (!pool || !clientId || !domain || !origin)
		throw new UploadError("הארכיון עדיין אינו זמין", 503);
	return {
		region,
		pool,
		clientId,
		domain,
		origin,
		issuer: `https://cognito-idp.${region}.amazonaws.com/${pool}`,
	};
}

/** Request-scoped cookies; changes also accompany expired-session responses. */
export class ArchiveCookies {
	readonly changes: string[] = [];
	constructor(private request: Request) {}
	get(name: string) {
		return parseCookie(this.request.headers.get("cookie") || "", name);
	}
	set(name: string, value: string, maxAge: number) {
		this.changes.push(
			`${name}=${encodeURIComponent(value)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
		);
	}
	apply(response: Response) {
		for (const cookie of this.changes)
			response.headers.append("Set-Cookie", cookie);
		for (const [name, value] of Object.entries(privateHeaders))
			response.headers.set(name, value);
		return response;
	}
}

export async function currentAdmin(
	request: Request,
): Promise<ArchiveUser | null> {
	if (skipAuthEnabled())
		return {
			id: "00000000-0000-0000-0000-000000000004",
			username: "local-admin",
			role: "admin",
		};
	const bearer = request.headers
		.get("authorization")
		?.match(/^Bearer\s+([^,]+)$/i)?.[1]
		?.trim();
	if (bearer && (await verifyServiceAccessToken(bearer)))
		return {
			id: "00000000-0000-0000-0000-000000000003",
			username: "admin-service",
			role: "admin",
		};
	const session = parseCookie(
		request.headers.get("cookie") || "",
		"admin_session",
	);
	if (!session) return null;
	const claims = await verifyIdTokenClaims(session);
	if (!claims?.sub || !isUploadId(claims.sub)) return null;
	return {
		id: claims.sub,
		username: claims.email || claims.sub,
		name: claims.name || claims.email,
		role: "admin",
	};
}

const keysets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function currentArchiver(
	jar: ArchiveCookies,
): Promise<ArchiveUser | null> {
	let token = jar.get(SESSION_COOKIE);
	const refresh = jar.get(REFRESH_COOKIE);
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
				!Number.isFinite(data.expires_in) ||
				data.expires_in <= 0
			)
				return null;
			token = data.access_token;
			({ payload } = await jwtVerify(token as string, keys, {
				issuer: config.issuer,
			}));
			jar.set(SESSION_COOKIE, token as string, Math.min(data.expires_in, 3600));
		}
		if (
			payload.token_use !== "access" ||
			payload.client_id !== config.clientId ||
			!isUploadId(payload.sub)
		)
			return null;
		// Online verification enforces Cognito disablement and token revocation.
		const user = await new CognitoIdentityProviderClient({
			region: config.region,
		}).send(new GetUserCommand({ AccessToken: token || undefined }));
		if (
			user.UserAttributes?.find((a) => a.Name === "sub")?.Value !== payload.sub
		)
			return null;
		const name = user.UserAttributes?.find((a) => a.Name === "name")?.Value;
		if (!name?.trim())
			throw new UploadError("שם המחבר חסר בחשבון. יש לפנות לצוות האתר.", 403);
		// This pool grants only archiver, regardless of username or custom claims.
		return {
			id: payload.sub,
			username: user.Username || payload.sub,
			name,
			role: "archiver",
		};
	} catch (error) {
		if (error instanceof UploadError) throw error;
		if (error instanceof errors.JOSEError) return null;
		if (
			error instanceof Error &&
			["NotAuthorizedException", "UserNotFoundException"].includes(error.name)
		)
			return null;
		throw new UploadError("לא ניתן לאמת את הכניסה כרגע", 503);
	}
}

export function loginFlow() {
	const config = authConfig();
	const state = randomBytes(32).toString("base64url"),
		verifier = randomBytes(32).toString("base64url");
	const params = new URLSearchParams({
		response_type: "code",
		client_id: config.clientId,
		redirect_uri: `${config.origin}/archive/auth/callback`,
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
	const a = Buffer.from(expected),
		b = Buffer.from(actual);
	return a.length === b.length && timingSafeEqual(a, b);
}
export function requireArchiveOrigin(request: Request) {
	if (request.headers.get("origin") !== authConfig().origin)
		throw new UploadError("בקשה אינה מורשית", 403);
}
