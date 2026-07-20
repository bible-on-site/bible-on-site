import { createRemoteJWKSet, jwtVerify } from "jose";

const COGNITO_REGION = "il-central-1";
const COGNITO_USER_POOL_ID = requireEnv("COGNITO_USER_POOL_ID");
const COGNITO_CLIENT_ID = requireEnv("COGNITO_CLIENT_ID");
const COGNITO_CLIENT_SECRET = requireEnv("COGNITO_CLIENT_SECRET");
const COGNITO_DOMAIN = requireEnv("COGNITO_DOMAIN");

// Machine-to-machine (client_credentials) access, for automated scripts to call
// the admin API without a browser/SAML session. Entirely optional/additive: if
// COGNITO_SERVICE_CLIENT_ID is not configured, verifyServiceAccessToken always
// returns false and only the existing cookie-based user login path is usable.
const COGNITO_SERVICE_CLIENT_ID =
	process.env.COGNITO_SERVICE_CLIENT_ID?.trim() || undefined;
const COGNITO_SERVICE_SCOPE =
	process.env.COGNITO_SERVICE_SCOPE?.trim() || "admin-api/service";

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value && process.env.SKIP_AUTH !== "true") {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value ?? "";
}

const ISSUER = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/${COGNITO_USER_POOL_ID}`;

const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));

export function getLoginUrl(origin: string): string {
	const params = new URLSearchParams({
		response_type: "code",
		client_id: COGNITO_CLIENT_ID,
		redirect_uri: `${origin}/auth/callback`,
		scope: "openid email profile",
		identity_provider: "AWSSSO",
	});
	return `https://${COGNITO_DOMAIN}/oauth2/authorize?${params}`;
}

export function getLogoutUrl(origin: string): string {
	const params = new URLSearchParams({
		client_id: COGNITO_CLIENT_ID,
		logout_uri: origin,
	});
	return `https://${COGNITO_DOMAIN}/logout?${params}`;
}

export async function exchangeCodeForTokens(
	code: string,
	origin: string,
): Promise<{ id_token: string; access_token: string; expires_in: number }> {
	const body = new URLSearchParams({
		grant_type: "authorization_code",
		code,
		client_id: COGNITO_CLIENT_ID,
		client_secret: COGNITO_CLIENT_SECRET,
		redirect_uri: `${origin}/auth/callback`,
	});

	const response = await fetch(`https://${COGNITO_DOMAIN}/oauth2/token`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: body.toString(),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Token exchange failed: ${response.status} ${text}`);
	}

	return response.json();
}

export async function verifyIdToken(token: string): Promise<boolean> {
	try {
		await jwtVerify(token, jwks, {
			issuer: ISSUER,
			audience: COGNITO_CLIENT_ID,
		});
		return true;
	} catch {
		return false;
	}
}

/**
 * Verifies a Cognito OAuth2 client_credentials access token minted for the
 * dedicated M2M app client. This is a separate, narrowly-scoped trust path
 * from verifyIdToken above: it only accepts access tokens (never ID tokens),
 * only from the specific service client_id, and only carrying the required
 * custom scope - never the browser-facing admin-web-app client.
 */
export async function verifyServiceAccessToken(
	token: string,
): Promise<boolean> {
	if (!COGNITO_SERVICE_CLIENT_ID) return false;
	try {
		const { payload } = await jwtVerify(token, jwks, { issuer: ISSUER });
		if (payload.token_use !== "access") return false;
		if (payload.client_id !== COGNITO_SERVICE_CLIENT_ID) return false;
		const scopes =
			typeof payload.scope === "string" ? payload.scope.split(" ") : [];
		return scopes.includes(COGNITO_SERVICE_SCOPE);
	} catch {
		return false;
	}
}

export function parseCookie(cookieHeader: string, name: string): string | null {
	for (const part of cookieHeader.split(";")) {
		const separatorIndex = part.indexOf("=");
		if (separatorIndex === -1) continue;
		const key = part.slice(0, separatorIndex).trim();
		if (key === name) {
			return decodeURIComponent(part.slice(separatorIndex + 1));
		}
	}
	return null;
}

export function buildSessionCookie(
	token: string,
	maxAge: number,
	secure: boolean,
): string {
	const flags = [
		`admin_session=${encodeURIComponent(token)}`,
		"HttpOnly",
		"Path=/",
		"SameSite=Lax",
		`Max-Age=${maxAge}`,
	];
	if (secure) flags.push("Secure");
	return flags.join("; ");
}

export function buildClearSessionCookie(): string {
	return "admin_session=; HttpOnly; Path=/; Max-Age=0";
}
