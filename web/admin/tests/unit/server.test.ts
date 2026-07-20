import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { verifyServiceAccessTokenMock, verifyIdTokenMock, handlerFetchMock } =
	vi.hoisted(() => ({
		verifyServiceAccessTokenMock: vi.fn(),
		verifyIdTokenMock: vi.fn(),
		handlerFetchMock: vi.fn(),
	}));

vi.mock("@tanstack/react-start/server-entry", () => ({
	default: { fetch: handlerFetchMock },
	createServerEntry: (config: {
		fetch: (request: Request) => Promise<Response>;
	}) => config,
}));

vi.mock("~/server/auth", () => ({
	buildClearSessionCookie: vi.fn(),
	buildSessionCookie: vi.fn(),
	exchangeCodeForTokens: vi.fn(),
	getLoginUrl: vi.fn(() => "https://login.example.com"),
	getLogoutUrl: vi.fn(),
	parseCookie: vi.fn(() => null),
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
});
