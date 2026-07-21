import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { jwtVerifyMock } = vi.hoisted(() => ({
	jwtVerifyMock: vi.fn(),
}));

vi.mock("jose", () => ({
	createRemoteJWKSet: () => ({}),
	jwtVerify: jwtVerifyMock,
}));

async function loadAuth() {
	vi.resetModules();
	return import("~/server/auth");
}

function stubRequiredAuthEnv() {
	vi.stubEnv("COGNITO_USER_POOL_ID", "pool-id");
	vi.stubEnv("COGNITO_CLIENT_ID", "web-client");
	vi.stubEnv("COGNITO_CLIENT_SECRET", "web-secret");
	vi.stubEnv("COGNITO_DOMAIN", "example.auth.il-central-1.amazoncognito.com");
}

describe("verifyServiceAccessToken", () => {
	beforeEach(() => {
		jwtVerifyMock.mockReset();
		stubRequiredAuthEnv();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("returns false when no service client is configured (feature disabled)", async () => {
		vi.stubEnv("COGNITO_SERVICE_CLIENT_ID", "");
		const { verifyServiceAccessToken } = await loadAuth();

		expect(await verifyServiceAccessToken("token")).toBe(false);
		expect(jwtVerifyMock).not.toHaveBeenCalled();
	});

	it("rejects an ID token (wrong token_use)", async () => {
		vi.stubEnv("COGNITO_SERVICE_CLIENT_ID", "svc-client");
		jwtVerifyMock.mockResolvedValue({
			payload: {
				token_use: "id",
				client_id: "svc-client",
				scope: "admin-api/service",
			},
		});
		const { verifyServiceAccessToken } = await loadAuth();

		expect(await verifyServiceAccessToken("token")).toBe(false);
	});

	it("rejects a token minted for a different client_id", async () => {
		vi.stubEnv("COGNITO_SERVICE_CLIENT_ID", "svc-client");
		jwtVerifyMock.mockResolvedValue({
			payload: {
				token_use: "access",
				client_id: "admin-web-app",
				scope: "admin-api/service",
			},
		});
		const { verifyServiceAccessToken } = await loadAuth();

		expect(await verifyServiceAccessToken("token")).toBe(false);
	});

	it("rejects a token missing the required scope", async () => {
		vi.stubEnv("COGNITO_SERVICE_CLIENT_ID", "svc-client");
		jwtVerifyMock.mockResolvedValue({
			payload: {
				token_use: "access",
				client_id: "svc-client",
				scope: "some-other/scope",
			},
		});
		const { verifyServiceAccessToken } = await loadAuth();

		expect(await verifyServiceAccessToken("token")).toBe(false);
	});

	it("accepts a valid service access token", async () => {
		vi.stubEnv("COGNITO_SERVICE_CLIENT_ID", "svc-client");
		jwtVerifyMock.mockResolvedValue({
			payload: {
				token_use: "access",
				client_id: "svc-client",
				scope: "admin-api/service",
			},
		});
		const { verifyServiceAccessToken } = await loadAuth();

		expect(await verifyServiceAccessToken("token")).toBe(true);
	});

	it("returns false when jwtVerify throws (invalid signature/expired)", async () => {
		vi.stubEnv("COGNITO_SERVICE_CLIENT_ID", "svc-client");
		jwtVerifyMock.mockRejectedValue(new Error("signature verification failed"));
		const { verifyServiceAccessToken } = await loadAuth();

		expect(await verifyServiceAccessToken("token")).toBe(false);
	});
});

describe("parseCookie", () => {
	beforeEach(() => {
		stubRequiredAuthEnv();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("extracts the named cookie's value", async () => {
		const { parseCookie } = await loadAuth();

		expect(
			parseCookie("admin_session=abc123; other=xyz", "admin_session"),
		).toBe("abc123");
	});

	it("finds the named cookie among several, regardless of position", async () => {
		const { parseCookie } = await loadAuth();

		expect(parseCookie("a=1; admin_session=abc123; b=2", "admin_session")).toBe(
			"abc123",
		);
	});

	it("decodes percent-encoded values", async () => {
		const { parseCookie } = await loadAuth();

		expect(parseCookie("admin_session=a%20b", "admin_session")).toBe("a b");
	});

	it("returns null when the cookie is missing", async () => {
		const { parseCookie } = await loadAuth();

		expect(parseCookie("other=xyz", "admin_session")).toBeNull();
	});

	it("returns null for an empty cookie header", async () => {
		const { parseCookie } = await loadAuth();

		expect(parseCookie("", "admin_session")).toBeNull();
	});

	it("does not partially match a cookie name that is a substring of another", async () => {
		const { parseCookie } = await loadAuth();

		expect(
			parseCookie(
				"admin_session_extra=nope; admin_session=abc123",
				"admin_session",
			),
		).toBe("abc123");
	});

	it("returns null instead of throwing on malformed percent-encoding", async () => {
		const { parseCookie } = await loadAuth();

		expect(parseCookie("admin_session=a%b", "admin_session")).toBeNull();
	});
});

describe("browser auth helpers", () => {
	beforeEach(() => {
		jwtVerifyMock.mockReset();
		stubRequiredAuthEnv();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it("builds Cognito login and logout URLs", async () => {
		const { getLoginUrl, getLogoutUrl } = await loadAuth();

		const login = new URL(getLoginUrl("https://admin.example.com"));
		expect(login.origin).toBe("https://example.auth.il-central-1.amazoncognito.com");
		expect(login.pathname).toBe("/oauth2/authorize");
		expect(login.searchParams.get("response_type")).toBe("code");
		expect(login.searchParams.get("client_id")).toBe("web-client");
		expect(login.searchParams.get("redirect_uri")).toBe("https://admin.example.com/auth/callback");
		expect(login.searchParams.get("scope")).toBe("openid email profile");
		expect(login.searchParams.get("identity_provider")).toBe("AWSSSO");

		const logout = new URL(getLogoutUrl("https://admin.example.com"));
		expect(logout.origin).toBe("https://example.auth.il-central-1.amazoncognito.com");
		expect(logout.pathname).toBe("/logout");
		expect(logout.searchParams.get("client_id")).toBe("web-client");
		expect(logout.searchParams.get("logout_uri")).toBe("https://admin.example.com");
	});

	it("exchanges authorization code for Cognito tokens", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: () =>
				Promise.resolve({
					id_token: "id-token",
					access_token: "access-token",
					expires_in: 3600,
				}),
		});
		vi.stubGlobal("fetch", fetchMock);
		const { exchangeCodeForTokens } = await loadAuth();

		await expect(exchangeCodeForTokens("auth-code", "https://admin.example.com")).resolves.toEqual({
			id_token: "id-token",
			access_token: "access-token",
			expires_in: 3600,
		});
		expect(fetchMock).toHaveBeenCalledWith(
			"https://example.auth.il-central-1.amazoncognito.com/oauth2/token",
			expect.objectContaining({
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
			}),
		);
		const body = new URLSearchParams(fetchMock.mock.calls[0]?.[1].body);
		expect(body.get("grant_type")).toBe("authorization_code");
		expect(body.get("code")).toBe("auth-code");
		expect(body.get("client_id")).toBe("web-client");
		expect(body.get("client_secret")).toBe("web-secret");
		expect(body.get("redirect_uri")).toBe("https://admin.example.com/auth/callback");
	});

	it("throws when token exchange fails", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				status: 400,
				text: () => Promise.resolve("bad code"),
			}),
		);
		const { exchangeCodeForTokens } = await loadAuth();

		await expect(exchangeCodeForTokens("bad-code", "https://admin.example.com")).rejects.toThrow(
			"Token exchange failed: 400 bad code",
		);
	});

	it("verifies browser ID tokens for the configured client", async () => {
		jwtVerifyMock.mockResolvedValue({ payload: {} });
		const { verifyIdToken } = await loadAuth();

		await expect(verifyIdToken("id-token")).resolves.toBe(true);
		expect(jwtVerifyMock).toHaveBeenCalledWith(
			"id-token",
			expect.anything(),
			{
				issuer: "https://cognito-idp.il-central-1.amazonaws.com/pool-id",
				audience: "web-client",
			},
		);
	});

	it("returns false when browser ID token verification fails", async () => {
		jwtVerifyMock.mockRejectedValue(new Error("expired"));
		const { verifyIdToken } = await loadAuth();

		await expect(verifyIdToken("expired-token")).resolves.toBe(false);
	});

	it("builds session cookies", async () => {
		const { buildClearSessionCookie, buildSessionCookie } = await loadAuth();

		expect(buildSessionCookie("token value", 3600, false)).toBe(
			"admin_session=token%20value; HttpOnly; Path=/; SameSite=Lax; Max-Age=3600",
		);
		expect(buildSessionCookie("token", 60, true)).toBe(
			"admin_session=token; HttpOnly; Path=/; SameSite=Lax; Max-Age=60; Secure",
		);
		expect(buildClearSessionCookie()).toBe("admin_session=; HttpOnly; Path=/; Max-Age=0");
	});
});
