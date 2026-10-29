import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Issue #2611 regression: an expired Cognito session used to return the
// login 302 for server-function calls too, which a cross-origin fetch cannot
// follow — the client saw an opaque network error and autosave retried
// forever. Server-fn calls (x-tsr-serverFn) now get a plain 401 the client
// can classify; page navigations keep the Cognito redirect.

const {
	handlerFetchMock,
	verifyIdTokenMock,
	verifyServiceTokenMock,
	parseCookieMock,
	getLoginUrlMock,
} = vi.hoisted(() => ({
	handlerFetchMock: vi.fn(),
	verifyIdTokenMock: vi.fn(),
	verifyServiceTokenMock: vi.fn(),
	parseCookieMock: vi.fn(),
	getLoginUrlMock: vi.fn(),
}));

vi.mock("@tanstack/react-start/server-entry", () => ({
	default: { fetch: handlerFetchMock },
	createServerEntry: (opts: {
		fetch: (request: Request) => Promise<Response>;
	}) => opts,
}));

// Worker startup and dedication scheduling have their own integration suites.
// Authentication/coverage assertions must not load their DB/provider graph.
vi.mock("~/server/email-worker-runtime.server", () => ({
	ensureEmailWorkerStarted: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/server/dedication-expiry", () => ({
	rescanDedicationExpiries: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/server/auth", () => ({
	buildClearSessionCookie: vi.fn(),
	buildSessionCookie: vi.fn(),
	exchangeCodeForTokens: vi.fn(),
	getLoginUrl: getLoginUrlMock,
	getLogoutUrl: vi.fn(),
	parseCookie: parseCookieMock,
	verifyIdToken: verifyIdTokenMock,
	verifyServiceAccessToken: verifyServiceTokenMock,
}));

interface ServerEntry {
	fetch: (request: Request) => Promise<Response>;
}

async function loadEntry(): Promise<ServerEntry> {
	vi.resetModules();
	const mod = (await import("~/server.tsx")) as {
		default?: ServerEntry;
	} & ServerEntry;
	return mod.default ?? mod;
}

function serverFnRequest(): Request {
	return new Request("https://admin.test/_serverFn/abc123", {
		method: "POST",
		headers: { "x-tsr-serverFn": "true" },
	});
}

describe("server entry auth boundary", () => {
	beforeEach(() => {
		handlerFetchMock
			.mockReset()
			.mockResolvedValue(new Response("page", { status: 200 }));
		verifyIdTokenMock.mockReset().mockResolvedValue(false);
		verifyServiceTokenMock.mockReset().mockResolvedValue(false);
		parseCookieMock.mockReset().mockReturnValue(null);
		getLoginUrlMock.mockReset().mockReturnValue("https://cognito.test/login");
		vi.stubEnv("SKIP_AUTH", "false");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("returns a classifiable 401 for a server-function call without a session", async () => {
		const entry = await loadEntry();
		const response = await entry.fetch(serverFnRequest());

		expect(response.status).toBe(401);
		expect(await response.text()).toContain("SESSION_EXPIRED");
		expect(response.headers.get("location")).toBeNull();
		expect(handlerFetchMock).not.toHaveBeenCalled();
	});

	it("keeps the Cognito redirect for a page navigation without a session", async () => {
		const entry = await loadEntry();
		const response = await entry.fetch(
			new Request("https://admin.test/tanahpedia/entries/entry-1"),
		);

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("https://cognito.test/login");
		expect(handlerFetchMock).not.toHaveBeenCalled();
	});

	it("passes an authenticated request through to the handler", async () => {
		parseCookieMock.mockReturnValue("valid-session");
		verifyIdTokenMock.mockResolvedValue(true);
		const entry = await loadEntry();
		const response = await entry.fetch(
			new Request("https://admin.test/tanahpedia"),
		);

		expect(response.status).toBe(200);
		expect(handlerFetchMock).toHaveBeenCalledOnce();
	});

	it("returns 401 for a server-fn call whose session token fails verification", async () => {
		parseCookieMock.mockReturnValue("expired-session");
		verifyIdTokenMock.mockResolvedValue(false);
		const entry = await loadEntry();
		const response = await entry.fetch(serverFnRequest());

		expect(response.status).toBe(401);
		expect(handlerFetchMock).not.toHaveBeenCalled();
	});

	it("lets a valid M2M bearer token through regardless of call kind", async () => {
		verifyServiceTokenMock.mockResolvedValue(true);
		const entry = await loadEntry();
		const response = await entry.fetch(
			new Request("https://admin.test/_serverFn/abc123", {
				method: "POST",
				headers: {
					authorization: "Bearer service-token",
					"x-tsr-serverFn": "true",
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(handlerFetchMock).toHaveBeenCalledOnce();
	});
});
