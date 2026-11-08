import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	appFetch: vi.fn(),
	rescan: vi.fn(),
	startWorker: vi.fn(),
	parseCookie: vi.fn(),
	verifyIdToken: vi.fn(),
	verifyServiceToken: vi.fn(),
}));

vi.mock("@tanstack/react-start/server-entry", () => ({
	default: { fetch: mocks.appFetch },
	createServerEntry: (entry: {
		fetch: (request: Request) => Promise<Response>;
	}) => entry,
}));
vi.mock("~/server/dedication-expiry", () => ({
	rescanDedicationExpiries: mocks.rescan,
}));
vi.mock("~/server/email-worker-runtime.server", () => ({
	ensureEmailWorkerStarted: mocks.startWorker,
}));
vi.mock("~/server/auth", () => ({
	buildClearSessionCookie: vi.fn(),
	buildSessionCookie: vi.fn(),
	exchangeCodeForTokens: vi.fn(),
	getLoginUrl: vi.fn(() => "https://login.example.com"),
	getLogoutUrl: vi.fn(),
	parseCookie: mocks.parseCookie,
	verifyIdToken: mocks.verifyIdToken,
	verifyServiceAccessToken: mocks.verifyServiceToken,
}));

async function loadEntry() {
	vi.resetModules();
	return (await import("~/server")).default as {
		fetch: (request: Request) => Promise<Response>;
	};
}

function unauthenticatedRpc() {
	return new Request("https://admin.example.com/_serverFn/startup-fixture", {
		method: "POST",
		headers: { "x-tsr-serverFn": "true" },
	});
}

beforeEach(() => {
	vi.resetAllMocks();
	vi.stubEnv("SKIP_AUTH", "false");
	vi.stubEnv("MEASURE_COV", "0");
	vi.stubEnv("VITE_WEBSITE_URL", "https://website.example.com");
	vi.stubEnv("REVALIDATE_SECRET", "offline-test-secret");
	mocks.appFetch.mockResolvedValue(new Response("app"));
	mocks.rescan.mockResolvedValue(undefined);
	mocks.startWorker.mockResolvedValue(undefined);
	mocks.parseCookie.mockReturnValue(null);
	mocks.verifyIdToken.mockResolvedValue(false);
	mocks.verifyServiceToken.mockResolvedValue(false);
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe("admin startup integration", () => {
	it("runs dedication catch-up once at boot and awaits request-time worker startup before enforcing auth", async () => {
		let releaseWorker: () => void = () => {};
		mocks.startWorker.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					releaseWorker = resolve;
				}),
		);
		const entry = await loadEntry();
		expect(mocks.rescan).toHaveBeenCalledOnce();
		expect(mocks.startWorker).not.toHaveBeenCalled();

		const pending = entry.fetch(unauthenticatedRpc());
		expect(mocks.startWorker).toHaveBeenCalledOnce();
		expect(mocks.parseCookie).not.toHaveBeenCalled();
		expect(mocks.appFetch).not.toHaveBeenCalled();
		releaseWorker();
		const response = await pending;

		expect(response.status).toBe(401);
		expect(await response.text()).toContain("SESSION_EXPIRED");
		expect(mocks.parseCookie).toHaveBeenCalledOnce();
		expect(mocks.appFetch).not.toHaveBeenCalled();
		await entry.fetch(unauthenticatedRpc());
		expect(mocks.rescan).toHaveBeenCalledOnce();
	});

	it("contains a failed dedication catch-up while keeping request startup and auth operational", async () => {
		const failure = new Error("offline dedication catch-up fixture");
		mocks.rescan.mockRejectedValueOnce(failure);
		const entry = await loadEntry();
		const response = await entry.fetch(unauthenticatedRpc());

		expect(console.error).toHaveBeenCalledExactlyOnceWith(
			"dedication expiry rescan failed:",
			failure,
		);
		expect(mocks.startWorker).toHaveBeenCalledOnce();
		expect(response.status).toBe(401);
		expect(mocks.appFetch).not.toHaveBeenCalled();
	});

	it("surfaces worker startup failure before authentication or application dispatch", async () => {
		const failure = new Error(
			"Daily bulletin email worker stopped unexpectedly",
		);
		mocks.startWorker.mockRejectedValueOnce(failure);
		const entry = await loadEntry();

		await expect(entry.fetch(unauthenticatedRpc())).rejects.toBe(failure);
		expect(mocks.rescan).toHaveBeenCalledOnce();
		expect(mocks.parseCookie).not.toHaveBeenCalled();
		expect(mocks.verifyIdToken).not.toHaveBeenCalled();
		expect(mocks.verifyServiceToken).not.toHaveBeenCalled();
		expect(mocks.appFetch).not.toHaveBeenCalled();
	});

	it.each(["VITE_WEBSITE_URL", "REVALIDATE_SECRET"])(
		"skips dedication catch-up without %s while retaining request-time startup",
		async (name) => {
			vi.stubEnv(name, "");
			const entry = await loadEntry();
			expect(mocks.rescan).not.toHaveBeenCalled();
			expect(mocks.startWorker).not.toHaveBeenCalled();
			expect((await entry.fetch(unauthenticatedRpc())).status).toBe(401);
			expect(mocks.startWorker).toHaveBeenCalledOnce();
		},
	);
});
