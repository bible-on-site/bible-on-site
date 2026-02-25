import { createRemoteJWKSet, jwtVerify } from "jose";

const COGNITO_REGION = "il-central-1";
const COGNITO_USER_POOL_ID =
	process.env.COGNITO_USER_POOL_ID || "il-central-1_1jyMEBzqm";
const COGNITO_CLIENT_ID =
	process.env.COGNITO_CLIENT_ID || "3g2r20jej1u6kfao6hhvt1882k";
const COGNITO_CLIENT_SECRET = process.env.COGNITO_CLIENT_SECRET || "";
const COGNITO_DOMAIN =
	process.env.COGNITO_DOMAIN ||
	"bible-on-site-admin.auth.il-central-1.amazoncognito.com";

const ISSUER = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/${COGNITO_USER_POOL_ID}`;

const jwks = createRemoteJWKSet(
	new URL(`${ISSUER}/.well-known/jwks.json`),
);

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

	const response = await fetch(
		`https://${COGNITO_DOMAIN}/oauth2/token`,
		{
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: body.toString(),
		},
	);

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

export function parseCookie(
	cookieHeader: string,
	name: string,
): string | null {
	const match = cookieHeader.match(
		new RegExp(`(?:^|;\\s*)${name}=([^;]*)`),
	);
	return match ? decodeURIComponent(match[1]) : null;
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
