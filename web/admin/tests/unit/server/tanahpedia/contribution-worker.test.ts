import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Contribution } from "~/lib/tanahpedia/contributions";

const mocks = vi.hoisted(() => ({
	item: null as Contribution | null,
	query: vi.fn(),
	prepare: vi.fn(),
	create: vi.fn(),
}));
vi.mock("~/server/db", () => ({ txQuery: mocks.query }));
vi.mock("~/server/tanahpedia/contribution-store.server", () => ({
	withContributions: async (fn: (conn: object) => Promise<unknown>) => fn({}),
	readContribution: async () => structuredClone(mocks.item),
	saveContribution: async (_conn: object, item: Contribution) => {
		item.version++;
		mocks.item = structuredClone(item);
		return item;
	},
}));
vi.mock("~/server/tanahpedia/contribution-llm.server", () => ({
	prepareContributionGeneration: mocks.prepare,
	createGeneratedContributionPrs: mocks.create,
}));

import {
	claimContributionGeneration,
	completeContributionGeneration,
	failContributionGeneration,
} from "~/server/tanahpedia/contribution-worker.server";

const id = "00000000-0000-4000-8000-000000000001",
	jobId = "00000000-0000-4000-8000-000000000002";
function current() {
	if (!mocks.item) throw new Error("Missing fixture issue");
	return mocks.item;
}
function job() {
	const value = current().generation;
	if (!value) throw new Error("Missing fixture job");
	return value;
}
beforeEach(() => {
	vi.resetAllMocks();
	mocks.item = {
		id,
		number: 1,
		kind: "issue",
		state: "open",
		title: "Issue",
		description: "Evidence",
		author: { id: "human", name: "Editor", kind: "human", isDoradsoft: false },
		assignee: { kind: "local_llm" },
		evidence: [],
		changes: [],
		issueId: null,
		revision: 1,
		version: 1,
		events: [],
		createdAt: "date",
		updatedAt: "date",
		closeIssue: false,
		provenance: null,
		generation: {
			id: jobId,
			status: "queued",
			requestedAt: "date",
			requestedBy: "human",
			attempts: 0,
			apiVersion: 1,
			worker: null,
			model: null,
			leaseHash: null,
			leaseExpiresAt: null,
			claimedVersion: null,
			contextHash: null,
			outputHash: null,
			prIds: [],
			error: null,
		},
	};
	mocks.query.mockResolvedValue([{ id }]);
	mocks.prepare.mockImplementation(async () => ({
		issue: structuredClone(mocks.item),
		provider: "local_llm",
		schema: { type: "object" },
		system: "Draft only",
		user: "Saved evidence",
		modelCatalogue: {},
	}));
	mocks.create.mockImplementation(async (_context, _result, hooks) => {
		const item = structuredClone(current());
		await hooks.beforeCreate({}, item);
		const prs = [{ id: jobId }];
		await hooks.afterCreate({}, item, prs);
		item.version++;
		mocks.item = item;
		return prs;
	});
});
async function claimed() {
	const claim = await claimContributionGeneration({
		workerId: "workstation",
		issueId: id,
	});
	if (!claim) throw new Error("Missing fixture claim");
	return {
		issueId: id,
		jobId: claim.id,
		token: claim.token,
		version: claim.version,
		apiVersion: claim.apiVersion,
		model: "qwen3:4b",
		content: '{"pullRequests":[]}',
	};
}
describe("workstation generation leases", () => {
	it("claims queued work using a hashed lease and the saved context version", async () => {
		const lease = await claimed();
		expect(lease.version).toBe(2);
		expect(mocks.item?.generation).toMatchObject({
			status: "running",
			attempts: 1,
			worker: "workstation",
			claimedVersion: 2,
		});
		expect(mocks.item?.generation?.leaseHash).not.toBe(lease.token);
		expect(mocks.query.mock.calls[0][1]).toContain("FOR UPDATE SKIP LOCKED");
		expect(mocks.query.mock.calls[0][2]).toContain(id);
	});
	it("returns idle and bounds abandoned-job scanning without increasing inference deadlines", async () => {
		mocks.query.mockResolvedValueOnce([]);
		expect(await claimContributionGeneration({ workerId: "one" })).toBeNull();
		job().attempts = 3;
		expect(await claimContributionGeneration({ workerId: "one" })).toBeNull();
		expect(mocks.query).toHaveBeenCalledTimes(21);
		expect(mocks.item?.generation?.status).toBe("failed");
		expect(mocks.prepare).not.toHaveBeenCalled();
	});
	it("rejects malformed identifiers and lease tokens", async () => {
		await expect(
			claimContributionGeneration({ workerId: "one", issueId: "invalid" }),
		).rejects.toThrow("issueId");
		await expect(
			failContributionGeneration({
				issueId: id,
				jobId,
				token: "z".repeat(64),
				error: "invalid",
			}),
		).rejects.toThrow("lease");
		current().generation = undefined;
		await expect(
			claimContributionGeneration({ workerId: "one" }),
		).rejects.toThrow("request missing");
	});
	it("atomically completes a job and reuses only an identical acknowledged output", async () => {
		const input = await claimed();
		expect(await completeContributionGeneration(input)).toEqual({
			prIds: [jobId],
		});
		expect(mocks.item?.generation).toMatchObject({
			status: "completed",
			model: "qwen3:4b",
			prIds: [jobId],
			error: null,
		});
		expect(await completeContributionGeneration(input)).toEqual({
			prIds: [jobId],
		});
		expect(mocks.create).toHaveBeenCalledTimes(1);
		await expect(
			completeContributionGeneration({ ...input, content: "different output" }),
		).rejects.toThrow("replay");
		expect(mocks.item?.generation?.status).toBe("completed");
	});
	it.each([
		"token",
		"state",
		"assignee",
		"api",
		"version",
		"expiry",
		"catalogue",
	])("rejects %s drift before creating any proposals", async (kind) => {
		const input = await claimed(),
			item = current();
		if (kind === "token") input.token = "0".repeat(64);
		if (kind === "state") item.state = "closed";
		if (kind === "assignee") item.assignee = { kind: "unassigned" };
		if (kind === "api") input.apiVersion = 2;
		if (kind === "version") item.version++;
		if (kind === "expiry") job().leaseExpiresAt = "2000-01-01T00:00:00Z";
		if (kind === "catalogue")
			mocks.prepare.mockImplementationOnce(async () => ({
				issue: structuredClone(item),
				schema: {},
				system: "Changed catalogue",
				user: "Saved evidence",
			}));
		await expect(completeContributionGeneration(input)).rejects.toThrow();
		expect(mocks.create).not.toHaveBeenCalled();
		if (kind === "token") expect(item.generation?.status).toBe("running");
		else expect(mocks.item?.generation?.status).toBe("failed");
	});
	it("never lets a stale worker fail a replaced lease", async () => {
		const old = await claimed();
		const replacement = await claimed();
		expect(
			await failContributionGeneration({ ...old, error: "old worker" }),
		).toBe(false);
		expect(mocks.item?.generation?.status).toBe("running");
		expect(
			await failContributionGeneration({
				...replacement,
				error: "Model unavailable",
			}),
		).toBe(true);
		expect(mocks.item?.generation?.error).toBe("Model unavailable");
	});
	it("retains a concurrent successful receipt if the completion response was lost", async () => {
		const input = await claimed();
		const complete = mocks.create.getMockImplementation();
		if (!complete) throw new Error("Missing fixture completion");
		mocks.create.mockImplementationOnce(async (...args) => {
			await complete(...args);
			throw new Error("lost acknowledgement");
		});
		expect(await completeContributionGeneration(input)).toEqual({
			prIds: [jobId],
		});
		expect(mocks.item?.generation?.status).toBe("completed");
	});
	it("keeps storage details out of the issue's failure message", async () => {
		const input = await claimed();
		mocks.create.mockRejectedValueOnce(
			Object.assign(new Error("private SQL detail"), { code: "ER_DUP_ENTRY" }),
		);
		await expect(completeContributionGeneration(input)).rejects.toThrow(
			"private SQL detail",
		);
		expect(job().error).toBe(
			"Generation storage unavailable. Request generation again.",
		);
	});
});
