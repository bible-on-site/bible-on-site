import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	verify: vi.fn(),
	skip: vi.fn(),
	claim: vi.fn(),
	complete: vi.fn(),
	fail: vi.fn(),
}));
vi.mock("~/server/auth", () => ({
	verifyContributionWorkerAccessToken: mocks.verify,
}));
vi.mock("~/server/environment.server", () => ({ skipAuthEnabled: mocks.skip }));
vi.mock("~/server/tanahpedia/contribution-worker.server", () => ({
	claimContributionGeneration: mocks.claim,
	completeContributionGeneration: mocks.complete,
	failContributionGeneration: mocks.fail,
	ContributionWorkerConflict: class extends Error {},
}));

import { ContributionWorkerConflict } from "~/server/tanahpedia/contribution-worker.server";
import { handleContributionWorkerRequest } from "~/server/tanahpedia/contribution-worker-http.server";

const base = "https://admin.example/api/contributions/worker/";
function request(
	action = "claim",
	body: unknown = { workerId: "workstation" },
	headers: Record<string, string> = {
		Authorization: "Bearer machine-token",
		"Content-Type": "application/json",
	},
	origin = base,
) {
	return new Request(`${origin}${action}`, {
		method: "POST",
		headers,
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}
beforeEach(() => {
	vi.clearAllMocks();
	mocks.verify.mockResolvedValue(true);
	mocks.skip.mockReturnValue(false);
	mocks.claim.mockResolvedValue({ id: "job" });
	mocks.complete.mockResolvedValue({ prIds: ["pr"] });
	mocks.fail.mockResolvedValue(true);
});
afterEach(() => vi.restoreAllMocks());
describe("local worker HTTP trust boundary", () => {
	it("authenticates the service token and dispatches only supported worker operations", async () => {
		for (const [action, expected] of [
			["claim", { id: "job" }],
			["complete", { prIds: ["pr"] }],
			["fail", { updated: true }],
		] as const) {
			const response = await handleContributionWorkerRequest(request(action));
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual(expected);
			expect(response.headers.get("Cache-Control")).toBe("no-store");
		}
		expect(mocks.verify).toHaveBeenCalledWith("machine-token");
		expect(mocks.claim).toHaveBeenCalledWith({ workerId: "workstation" });
	});
	it("never accepts a browser session or an invalid bearer as worker authority", async () => {
		expect(
			(
				await handleContributionWorkerRequest(
					request(
						"claim",
						{},
						{
							Cookie: "admin_session=owner",
							"Content-Type": "application/json",
						},
					),
				)
			).status,
		).toBe(401);
		mocks.verify.mockResolvedValue(false);
		expect((await handleContributionWorkerRequest(request())).status).toBe(401);
		expect(
			(
				await handleContributionWorkerRequest(
					request(
						"claim",
						{},
						{ Authorization: `Bearer ${"x".repeat(16001)}` },
					),
				)
			).status,
		).toBe(401);
		expect(mocks.claim).not.toHaveBeenCalled();
	});
	it("permits the existing explicit auth bypass only on loopback local development", async () => {
		mocks.skip.mockReturnValue(true);
		mocks.verify.mockResolvedValue(false);
		expect(
			(
				await handleContributionWorkerRequest(
					request(
						"claim",
						{},
						{ "Content-Type": "application/json" },
						"http://localhost:3101/api/contributions/worker/",
					),
				)
			).status,
		).toBe(200);
		expect(
			(
				await handleContributionWorkerRequest(
					request("claim", {}, { "Content-Type": "application/json" }),
				)
			).status,
		).toBe(401);
	});
	it("rejects wrong methods, actions and oversized/non-JSON payloads before dispatch", async () => {
		expect(
			(await handleContributionWorkerRequest(new Request(`${base}claim`)))
				.status,
		).toBe(405);
		expect(
			(await handleContributionWorkerRequest(request("merge"))).status,
		).toBe(404);
		for (const value of [
			request("claim", "not json"),
			request(
				"claim",
				{},
				{
					Authorization: "Bearer token",
					"Content-Type": "application/json-invalid",
				},
			),
			request("claim", "x".repeat(512001)),
			request(
				"claim",
				{},
				{ Authorization: "Bearer token", "Content-Type": "text/plain" },
			),
			new Request(`${base}claim`, {
				method: "POST",
				headers: {
					Authorization: "Bearer token",
					"Content-Type": "application/json",
				},
			}),
		])
			expect((await handleContributionWorkerRequest(value)).status).toBe(400);
		expect(mocks.claim).not.toHaveBeenCalled();
	});
	it("returns no job when idle and distinguishes stale leases from storage failure", async () => {
		mocks.claim.mockResolvedValue(null);
		expect((await handleContributionWorkerRequest(request())).status).toBe(204);
		mocks.complete.mockRejectedValue(
			new ContributionWorkerConflict("Issue changed"),
		);
		expect(
			(await handleContributionWorkerRequest(request("complete"))).status,
		).toBe(409);
		mocks.claim.mockRejectedValue(
			Object.assign(new Error("private SQL"), { code: "ER_NO_SUCH_TABLE" }),
		);
		const unavailable = await handleContributionWorkerRequest(request());
		expect(unavailable.status).toBe(503);
		expect(await unavailable.text()).not.toContain("private SQL");
		mocks.claim.mockRejectedValue("bad");
		expect(
			await (await handleContributionWorkerRequest(request())).json(),
		).toEqual({ error: "Invalid worker request" });
	});
});
