import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	verifyServiceAccessTokenMock,
	verifyIdTokenMock,
	handlerFetchMock,
	parseCookieMock,
	exchangeCodeForTokensMock,
	buildSessionCookieMock,
	buildClearSessionCookieMock,
	getLoginUrlMock,
	getLogoutUrlMock,
} = vi.hoisted(() => ({
	verifyServiceAccessTokenMock: vi.fn(),
	verifyIdTokenMock: vi.fn(),
	handlerFetchMock: vi.fn(),
	parseCookieMock: vi.fn(),
	exchangeCodeForTokensMock: vi.fn(),
	buildSessionCookieMock: vi.fn(),
	buildClearSessionCookieMock: vi.fn(),
	getLoginUrlMock: vi.fn(),
	getLogoutUrlMock: vi.fn(),
}));

vi.mock("@tanstack/react-start/server-entry", () => ({
	default: { fetch: handlerFetchMock },
	createServerEntry: (config: {
		fetch: (request: Request) => Promise<Response>;
	}) => config,
}));

vi.mock("~/server/auth", () => ({
	buildClearSessionCookie: buildClearSessionCookieMock,
	buildSessionCookie: buildSessionCookieMock,
	exchangeCodeForTokens: exchangeCodeForTokensMock,
	getLoginUrl: getLoginUrlMock,
	getLogoutUrl: getLogoutUrlMock,
	parseCookie: parseCookieMock,
	verifyIdToken: verifyIdTokenMock,
	verifyServiceAccessToken: verifyServiceAccessTokenMock,
}));

async function loadServer() {
	vi.resetModules();
	const mod = await import("~/server");
	return mod.default as { fetch: (request: Request) => Promise<Response> };
}

describe("admin server auth gate", () => {
	beforeEach(() => {
		vi.stubEnv("SKIP_AUTH", "false");
		verifyServiceAccessTokenMock.mockReset();
		verifyIdTokenMock.mockReset();
		handlerFetchMock.mockReset();
		parseCookieMock.mockReset().mockReturnValue(null);
		exchangeCodeForTokensMock.mockReset();
		buildSessionCookieMock.mockReset();
		buildClearSessionCookieMock.mockReset();
		getLoginUrlMock.mockReset().mockReturnValue("https://login.example.com");
		getLogoutUrlMock.mockReset().mockReturnValue("https://logout.example.com");
		handlerFetchMock.mockResolvedValue(new Response("ok"));
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("allows a request bearing a valid service access token, bypassing the cookie check", async () => {
		verifyServiceAccessTokenMock.mockResolvedValue(true);
		const entry = await loadServer();

		const response = await entry.fetch(
			new Request("https://admin.example.com/", {
				headers: { authorization: "Bearer valid-token" },
			}),
		);

		expect(verifyServiceAccessTokenMock).toHaveBeenCalledWith("valid-token");
		expect(handlerFetchMock).toHaveBeenCalledTimes(1);
		expect(response.status).toBe(200);
		expect(verifyIdTokenMock).not.toHaveBeenCalled();
	});

	it("falls through to the cookie check when the Bearer token is invalid", async () => {
		verifyServiceAccessTokenMock.mockResolvedValue(false);
		verifyIdTokenMock.mockResolvedValue(false);
		const entry = await loadServer();

		const response = await entry.fetch(
			new Request("https://admin.example.com/", {
				headers: { authorization: "Bearer bad-token" },
			}),
		);

		expect(handlerFetchMock).not.toHaveBeenCalled();
		expect(response.status).toBe(302);
	});

	it("falls through to the cookie check when no Authorization header is present", async () => {
		verifyIdTokenMock.mockResolvedValue(false);
		const entry = await loadServer();

		const response = await entry.fetch(
			new Request("https://admin.example.com/"),
		);

		expect(verifyServiceAccessTokenMock).not.toHaveBeenCalled();
		expect(response.status).toBe(302);
	});

	it("serves the request once the session cookie holds a valid id token", async () => {
		parseCookieMock.mockReturnValue("session-token");
		verifyIdTokenMock.mockResolvedValue(true);
		const entry = await loadServer();

		const response = await entry.fetch(
			new Request("https://admin.example.com/", {
				headers: { cookie: "admin_session=session-token" },
			}),
		);

		expect(parseCookieMock).toHaveBeenCalledWith(
			"admin_session=session-token",
			"admin_session",
		);
		expect(handlerFetchMock).toHaveBeenCalledTimes(1);
		expect(response.status).toBe(200);
	});

	it("redirects to the login url over the forwarded http protocol", async () => {
		verifyIdTokenMock.mockResolvedValue(false);
		const entry = await loadServer();

		await entry.fetch(
			new Request("https://internal:3101/", {
				headers: {
					"x-forwarded-proto": "http",
					host: "admin.example.com",
				},
			}),
		);

		expect(getLoginUrlMock).toHaveBeenCalledWith("http://admin.example.com");
	});

	it("ignores a blank first forwarded-proto segment and uses the request url protocol", async () => {
		verifyIdTokenMock.mockResolvedValue(false);
		const entry = await loadServer();

		await entry.fetch(
			new Request("https://internal:3101/", {
				headers: {
					"x-forwarded-proto": " ,http",
					host: "admin.example.com",
				},
			}),
		);

		expect(getLoginUrlMock).toHaveBeenCalledWith("https://admin.example.com");
	});

	it("bypasses every auth check when SKIP_AUTH is enabled", async () => {
		vi.stubEnv("SKIP_AUTH", "true");
		const entry = await loadServer();

		const response = await entry.fetch(
			new Request("https://admin.example.com/"),
		);

		expect(handlerFetchMock).toHaveBeenCalledTimes(1);
		expect(response.status).toBe(200);
		expect(verifyServiceAccessTokenMock).not.toHaveBeenCalled();
		expect(verifyIdTokenMock).not.toHaveBeenCalled();
	});
});

describe("admin server auth routes", () => {
	beforeEach(() => {
		vi.stubEnv("SKIP_AUTH", "false");
		verifyServiceAccessTokenMock.mockReset();
		verifyIdTokenMock.mockReset();
		handlerFetchMock.mockReset();
		parseCookieMock.mockReset().mockReturnValue(null);
		exchangeCodeForTokensMock.mockReset();
		buildSessionCookieMock.mockReset();
		buildClearSessionCookieMock.mockReset();
		getLoginUrlMock.mockReset().mockReturnValue("https://login.example.com");
		getLogoutUrlMock.mockReset().mockReturnValue("https://logout.example.com");
		handlerFetchMock.mockResolvedValue(new Response("ok"));
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	describe("/auth/callback", () => {
		it("rejects a callback missing the authorization code", async () => {
			const entry = await loadServer();

			const response = await entry.fetch(
				new Request("https://admin.example.com/auth/callback"),
			);

			expect(response.status).toBe(400);
			expect(await response.text()).toBe("Missing authorization code");
			expect(exchangeCodeForTokensMock).not.toHaveBeenCalled();
		});

		it("exchanges the code, stores the session cookie and redirects home", async () => {
			exchangeCodeForTokensMock.mockResolvedValue({
				id_token: "id-token",
				access_token: "access-token",
				expires_in: 3600,
			});
			buildSessionCookieMock.mockReturnValue(
				"admin_session=id-token; HttpOnly",
			);
			const entry = await loadServer();

			const response = await entry.fetch(
				new Request("https://admin.example.com/auth/callback?code=abc123"),
			);

			expect(exchangeCodeForTokensMock).toHaveBeenCalledWith(
				"abc123",
				"https://admin.example.com",
			);
			expect(buildSessionCookieMock).toHaveBeenCalledWith(
				"id-token",
				3600,
				true,
			);
			expect(response.status).toBe(302);
			expect(response.headers.get("Location")).toBe("/");
			expect(response.headers.get("Set-Cookie")).toBe(
				"admin_session=id-token; HttpOnly",
			);
		});

		it("returns 500 when the token exchange fails", async () => {
			exchangeCodeForTokensMock.mockRejectedValue(new Error("sso down"));
			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			const entry = await loadServer();

			const response = await entry.fetch(
				new Request("https://admin.example.com/auth/callback?code=bad"),
			);

			expect(response.status).toBe(500);
			expect(await response.text()).toBe("Authentication failed");
			errorSpy.mockRestore();
		});
	});

	describe("/auth/logout", () => {
		it("clears the session cookie and redirects to the cognito logout url", async () => {
			buildClearSessionCookieMock.mockReturnValue(
				"admin_session=; HttpOnly; Path=/; Max-Age=0",
			);
			const entry = await loadServer();

			const response = await entry.fetch(
				new Request("https://admin.example.com/auth/logout"),
			);

			expect(getLogoutUrlMock).toHaveBeenCalledWith(
				"https://admin.example.com",
			);
			expect(response.status).toBe(302);
			expect(response.headers.get("Location")).toBe(
				"https://logout.example.com",
			);
			expect(response.headers.get("Set-Cookie")).toBe(
				"admin_session=; HttpOnly; Path=/; Max-Age=0",
			);
		});
	});
});

describe("admin server coverage drain", () => {
	beforeEach(() => {
		handlerFetchMock.mockReset();
		parseCookieMock.mockReset();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		delete (globalThis as { __coverage__?: unknown }).__coverage__;
	});

	it("returns and clears the accumulated istanbul coverage when measuring", async () => {
		vi.stubEnv("MEASURE_COV", "1");
		vi.stubEnv("SKIP_AUTH", "false");
		(globalThis as { __coverage__?: unknown }).__coverage__ = {
			"src/x.ts": { hits: 1 },
		};
		const entry = await loadServer();

		const response = await entry.fetch(
			new Request("https://admin.example.com/api/dev/coverage"),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ "src/x.ts": { hits: 1 } });
		expect((globalThis as { __coverage__?: unknown }).__coverage__).toEqual({});
		expect(handlerFetchMock).not.toHaveBeenCalled();
	});
});
