import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { appFetchMock } = vi.hoisted(() => ({
	appFetchMock: vi.fn(),
}));

vi.mock("@tanstack/react-start/server-entry", () => ({
	default: { fetch: appFetchMock },
	createServerEntry: (entry: { fetch: (request: Request) => unknown }) => entry,
}));

vi.mock("~/server/auth", () => ({
	buildClearSessionCookie: vi.fn(),
	buildSessionCookie: vi.fn(),
	exchangeCodeForTokens: vi.fn(),
	getLoginUrl: vi.fn(),
	getLogoutUrl: vi.fn(),
	parseCookie: vi.fn(),
	verifyIdToken: vi.fn(),
	verifyServiceAccessToken: vi.fn(),
}));

async function loadServer() {
	vi.resetModules();
	return import("~/server");
}

describe("/api/dev/coverage", () => {
	beforeEach(() => {
		appFetchMock.mockReset();
		appFetchMock.mockReturnValue(new Response("app"));
		vi.stubEnv("SKIP_AUTH", "true");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		delete (globalThis as { __coverage__?: unknown }).__coverage__;
	});

	it("returns the istanbul coverage map and drains it for the next pull", async () => {
		vi.stubEnv("MEASURE_COV", "1");
		(globalThis as { __coverage__?: unknown }).__coverage__ = {
			"src/example.ts": { path: "src/example.ts" },
		};
		const { default: entry } = await loadServer();

		const response = await entry.fetch(
			new Request("http://localhost:3101/api/dev/coverage"),
		);

		expect(await response.json()).toEqual({
			"src/example.ts": { path: "src/example.ts" },
		});
		expect((globalThis as { __coverage__?: unknown }).__coverage__).toEqual({});
		expect(appFetchMock).not.toHaveBeenCalled();
	});

	it("returns an empty object when nothing was instrumented yet", async () => {
		vi.stubEnv("MEASURE_COV", "1");
		const { default: entry } = await loadServer();

		const response = await entry.fetch(
			new Request("http://localhost:3101/api/dev/coverage"),
		);

		expect(await response.json()).toEqual({});
	});

	it("passes coverage requests through when not measuring coverage", async () => {
		const { default: entry } = await loadServer();

		const response = await entry.fetch(
			new Request("http://localhost:3101/api/dev/coverage"),
		);

		expect(await response.text()).toBe("app");
		expect(appFetchMock).toHaveBeenCalledOnce();
	});

	it("passes other paths through while measuring coverage", async () => {
		vi.stubEnv("MEASURE_COV", "1");
		const { default: entry } = await loadServer();

		const response = await entry.fetch(
			new Request("http://localhost:3101/articles"),
		);

		expect(await response.text()).toBe("app");
		expect(appFetchMock).toHaveBeenCalledOnce();
	});
});
