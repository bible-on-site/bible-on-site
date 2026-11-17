import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	backendLoaded: vi.fn(),
	verify: vi.fn().mockResolvedValue(false),
	claim: vi.fn().mockResolvedValue(null),
}));

vi.mock("~/server/auth", () => ({
	verifyContributionWorkerAccessToken: mocks.verify,
}));
vi.mock("~/server/environment.server", () => ({
	skipAuthEnabled: () => false,
}));
vi.mock("~/server/tanahpedia/contribution-worker.server", () => {
	mocks.backendLoaded();
	return {
		ContributionWorkerConflict: class extends Error {},
		claimContributionGeneration: mocks.claim,
		completeContributionGeneration: vi.fn(),
		failContributionGeneration: vi.fn(),
		getContributionWorkerBundle: vi.fn(),
		readContributionWorkerContext: vi.fn(),
	};
});

it("loads the generation backend only after worker authorization and route validation", async () => {
	const { handleContributionWorkerRequest } = await import(
		"~/server/tanahpedia/contribution-worker-http.server"
	);
	// Keep this assertion before any request or mock reset: an eager import
	// already initializes the real adapter's DB/provider dependency graph.
	expect(mocks.backendLoaded).not.toHaveBeenCalled();
	const base = "https://admin.test/api/contributions/worker/";
	const post = (action: string, headers: Record<string, string> = {}) =>
		new Request(`${base}${action}`, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...headers },
			body: JSON.stringify({ workerId: "loading-fixture" }),
		});

	expect(
		(await handleContributionWorkerRequest(new Request(`${base}claim`))).status,
	).toBe(405);
	const unauthorizedHeaderCases: Record<string, string>[] = [
		{},
		{ Cookie: "admin_session=owner" },
		{ Authorization: "Bearer invalid-worker-token" },
		{ Authorization: `Bearer ${"x".repeat(16001)}` },
	];
	for (const headers of unauthorizedHeaderCases)
		expect(
			(await handleContributionWorkerRequest(post("claim", headers))).status,
		).toBe(401);
	expect(mocks.backendLoaded).not.toHaveBeenCalled();
	expect(mocks.claim).not.toHaveBeenCalled();

	mocks.verify.mockResolvedValue(true);
	expect(
		(
			await handleContributionWorkerRequest(
				post("merge", { Authorization: "Bearer valid-worker-token" }),
			)
		).status,
	).toBe(404);
	expect(mocks.backendLoaded).not.toHaveBeenCalled();

	expect(
		(
			await handleContributionWorkerRequest(
				post("claim", { Authorization: "Bearer valid-worker-token" }),
			)
		).status,
	).toBe(204);
	expect(mocks.backendLoaded).toHaveBeenCalledOnce();
	expect(mocks.claim).toHaveBeenCalledWith({ workerId: "loading-fixture" });
});
