import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	identity: vi.fn(),
	list: vi.fn(),
	read: vi.fn(),
	catalogue: vi.fn(),
	create: vi.fn(),
	edit: vi.fn(),
	update: vi.fn(),
	merge: vi.fn(),
	recover: vi.fn(),
	status: vi.fn(),
	generate: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({
		handler: (fn: unknown) => fn,
		validator: (validator: (input: unknown) => unknown) => ({
			handler:
				(handler: (args: { data: unknown }) => unknown) =>
				(input: { data: unknown }) =>
					handler({ data: validator(input.data) }),
		}),
	}),
}));
vi.mock("~/server/tanahpedia/contribution-identity.server", () => ({
	contributionIdentity: mocks.identity,
}));
vi.mock("~/server/tanahpedia/contribution-store.server", () => ({
	listContributions: mocks.list,
	readContribution: mocks.read,
	withContributions: (fn: (conn: object) => unknown) => fn({}),
}));
vi.mock("~/server/tanahpedia/contribution-changes.server", () => ({
	contributionCatalogue: mocks.catalogue,
}));
vi.mock("~/server/tanahpedia/contribution-service.server", () => ({
	createContribution: mocks.create,
	editContribution: mocks.edit,
	updateContribution: mocks.update,
	mergeContribution: mocks.merge,
	recoverContributionSequence: mocks.recover,
}));
vi.mock("~/server/tanahpedia/contribution-llm.server", () => ({
	contributionLlmStatus: mocks.status,
	generateContributionPrs: mocks.generate,
}));

import {
	createContributionItem,
	editContributionItem,
	generateIssuePrs,
	getContribution,
	getContributionCatalogue,
	getContributionLlmStatus,
	getContributionSession,
	getContributions,
	mergeContributionItem,
	recoverContributionItem,
	updateContributionItem,
} from "~/server/tanahpedia/contributions";

describe("contribution RPC boundary", () => {
	beforeEach(() => {
		for (const mock of Object.values(mocks)) mock.mockReset();
		mocks.identity.mockResolvedValue({ id: "verified" });
	});
	it("returns only a verified account session", async () => {
		expect(await getContributionSession()).toEqual({ id: "verified" });
	});
	it("authenticates list, detail, catalogue and provider status reads", async () => {
		await getContributions();
		await getContribution({ data: "00000000-0000-4000-8000-000000000001" });
		await getContributionCatalogue();
		await getContributionLlmStatus();
		expect(mocks.identity).toHaveBeenCalledTimes(4);
		expect(mocks.list).toHaveBeenCalled();
		expect(mocks.read).toHaveBeenCalledWith(
			expect.anything(),
			"00000000-0000-4000-8000-000000000001",
		);
		expect(mocks.catalogue).toHaveBeenCalled();
		expect(mocks.status).toHaveBeenCalled();
	});
	it.each([
		[createContributionItem, "create"],
		[editContributionItem, "edit"],
		[updateContributionItem, "update"],
		[mergeContributionItem, "merge"],
		[recoverContributionItem, "recover"],
	] as const)("passes verified identities to mutations", async (fn, key) => {
		await fn({ data: { test: "payload" } });
		expect(mocks[key]).toHaveBeenCalledWith(
			{ test: "payload" },
			{ id: "verified" },
		);
	});
	it("authenticates generation before running a provider", async () => {
		await generateIssuePrs({ data: { id: "issue" } });
		expect(mocks.generate).toHaveBeenCalledWith({ id: "issue" });
		mocks.identity.mockRejectedValue(new Error("unauthenticated"));
		await expect(generateIssuePrs({ data: {} })).rejects.toThrow(
			"unauthenticated",
		);
		expect(mocks.generate).toHaveBeenCalledTimes(1);
	});
	it("fails closed on account resolution failures", async () => {
		mocks.identity.mockRejectedValue(new Error("unauthenticated"));
		await expect(getContributions()).rejects.toThrow();
		expect(mocks.list).not.toHaveBeenCalled();
	});
});
