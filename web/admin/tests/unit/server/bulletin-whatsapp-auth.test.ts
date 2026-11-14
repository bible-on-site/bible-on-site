import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	fetch: vi.fn(),
	cookie: vi.fn(),
	user: vi.fn(),
	service: vi.fn(),
}));
vi.mock("@tanstack/react-start/server-entry", () => ({
	default: { fetch: mocks.fetch },
	createServerEntry: (entry: unknown) => entry,
}));
vi.mock("~/server/auth", () => ({
	buildClearSessionCookie: vi.fn(),
	buildSessionCookie: vi.fn(),
	exchangeCodeForTokens: vi.fn(),
	getLoginUrl: vi.fn(() => "https://example.com/login"),
	getLogoutUrl: vi.fn(),
	parseCookie: mocks.cookie,
	verifyIdToken: mocks.user,
	verifyServiceAccessToken: mocks.service,
}));
vi.mock("~/server/email-worker-runtime.server", () => ({
	ensureEmailWorkerStarted: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/server/dedication-expiry", () => ({
	rescanDedicationExpiries: vi.fn(),
}));

async function entry() {
	vi.resetModules();
	return (await import("~/server.tsx")).default;
}

describe("WhatsApp actions share the production authentication boundary", () => {
	beforeEach(() => {
		vi.stubEnv("SKIP_AUTH", "false");
		vi.stubEnv("VITE_WEBSITE_URL", "");
		vi.stubEnv("REVALIDATE_SECRET", "");
		mocks.fetch.mockReset().mockImplementation(() => new Response("handled"));
		mocks.cookie.mockReset().mockReturnValue(null);
		mocks.user.mockReset().mockResolvedValue(false);
		mocks.service.mockReset().mockResolvedValue(false);
	});
	afterEach(() => vi.unstubAllEnvs());
	it.each([
		["cached-state", "GET"],
		["connection-check", "POST"],
		["audience-change", "POST"],
		["enqueue", "POST"],
	])(
		"rejects unauthenticated %s before application dispatch",
		async (name, method) => {
			const server = await entry();
			const response = await server.fetch(
				new Request(`https://admin.example.com/_serverFn/${name}`, {
					method,
					headers: { "x-tsr-serverFn": "true" },
				}),
			);
			expect(response.status).toBe(401);
			expect(mocks.fetch).not.toHaveBeenCalled();
		},
	);
	it("accepts the existing verified admin session for an explicit action", async () => {
		mocks.cookie.mockReturnValue("test-session");
		mocks.user.mockResolvedValue(true);
		const server = await entry();
		expect(
			(
				await server.fetch(
					new Request("https://admin.example.com/_serverFn/connection-check", {
						method: "POST",
						headers: { "x-tsr-serverFn": "true" },
					}),
				)
			).status,
		).toBe(200);
		expect(mocks.fetch).toHaveBeenCalledOnce();
	});
	it("accepts the existing scoped service token and rejects an invalid bearer", async () => {
		const server = await entry();
		const request = () =>
			new Request("https://admin.example.com/_serverFn/enqueue", {
				method: "POST",
				headers: {
					authorization: "Bearer fixture-token",
					"x-tsr-serverFn": "true",
				},
			});
		expect((await server.fetch(request())).status).toBe(401);
		mocks.service.mockResolvedValue(true);
		expect((await server.fetch(request())).status).toBe(200);
		expect(mocks.fetch).toHaveBeenCalledOnce();
	});
});
