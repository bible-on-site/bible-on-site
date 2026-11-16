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
	agents: vi.fn(),
	installAgent: vi.fn(),
	updateAgent: vi.fn(),
	reconcileAgents: vi.fn(),
	notifyAgents: vi.fn(),
	preview: vi.fn(),
}));
vi.mock("~/server/tanahpedia/contribution-agent-registry.server", () => ({
	listContributionAgents: mocks.agents,
	installRegisteredContributionAgent: mocks.installAgent,
	updateRegisteredContributionAgent: mocks.updateAgent,
}));
vi.mock("~/server/tanahpedia/contribution-agent-runtime.server", () => ({
	reconcileContributionAgentAssignments: mocks.reconcileAgents,
	notifyContributionAgentWork: mocks.notifyAgents,
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
vi.mock("~/server/tanahpedia/contribution-article-links.server", () => ({
	readArticleLinkPreview: mocks.preview,
}));
vi.mock("~/server/tanahpedia/contribution-store.server", () => ({
	listContributions: mocks.list,
	withContributions: (fn: (conn: object) => unknown) => fn({}),
}));
vi.mock("~/server/tanahpedia/contribution-migrations.server", () => ({
	readCurrentContribution: mocks.read,
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
	getContributionAgents,
	getContributionArticleLinkPreview,
	getContributionCatalogue,
	getContributionLlmStatus,
	getContributionSession,
	getContributions,
	installContributionAgent,
	mergeContributionItem,
	recoverContributionItem,
	updateContributionAgent,
	updateContributionItem,
} from "~/server/tanahpedia/contributions";

describe("contribution RPC boundary", () => {
	it("requires verified identity and a canonical numeric ID before article preview", async () => {
		mocks.identity.mockResolvedValue({ id: "human" });
		mocks.preview.mockResolvedValue({ id: "123", title: "מאמר", state: {} });
		expect(
			await getContributionArticleLinkPreview({ data: "123" }),
		).toMatchObject({ id: "123" });
		expect(mocks.preview).toHaveBeenCalledWith({}, "123");
		expect(() =>
			getContributionArticleLinkPreview({ data: "00123" }),
		).toThrow();
		mocks.identity.mockRejectedValue(new Error("Sign in"));
		mocks.preview.mockClear();
		await expect(
			getContributionArticleLinkPreview({ data: "123" }),
		).rejects.toThrow("Sign in");
		expect(mocks.preview).not.toHaveBeenCalled();
	});
	beforeEach(() => {
		for (const mock of Object.values(mocks)) mock.mockReset();
		mocks.identity.mockResolvedValue({ id: "verified" });
		mocks.updateAgent.mockResolvedValue({ id: "agent", version: 2 });
		mocks.reconcileAgents.mockResolvedValue({ queued: 1 });
	});
	it("authenticates agent registration reads and writes and reconciles saved updates", async () => {
		mocks.agents.mockResolvedValue([{ id: "agent" }]);
		mocks.installAgent.mockResolvedValue({ id: "new" });
		expect(await getContributionAgents()).toEqual([{ id: "agent" }]);
		expect(await installContributionAgent({ data: { name: "Agent" } })).toEqual(
			{ id: "new" },
		);
		expect(
			await updateContributionAgent({
				data: { id: "agent", version: 1, action: "upgrade" },
			}),
		).toEqual({ id: "agent", version: 2 });
		expect(mocks.identity).toHaveBeenCalledTimes(3);
		expect(mocks.reconcileAgents).toHaveBeenCalledWith("agent");
		expect(mocks.notifyAgents).toHaveBeenCalledOnce();
	});
	it("never calls registration storage without a verified identity", async () => {
		mocks.identity.mockRejectedValue(new Error("unauthenticated"));
		await expect(getContributionAgents()).rejects.toThrow("unauthenticated");
		await expect(installContributionAgent({ data: {} })).rejects.toThrow(
			"unauthenticated",
		);
		await expect(updateContributionAgent({ data: {} })).rejects.toThrow(
			"unauthenticated",
		);
		expect(mocks.agents).not.toHaveBeenCalled();
		expect(mocks.installAgent).not.toHaveBeenCalled();
		expect(mocks.updateAgent).not.toHaveBeenCalled();
	});
	it("reports a post-commit reconciliation failure as saved configuration needing work recovery", async () => {
		mocks.reconcileAgents.mockRejectedValue(new Error("DB unavailable"));
		await expect(
			updateContributionAgent({
				data: { id: "agent", version: 1, action: "upgrade" },
			}),
		).rejects.toThrow("configuration was saved");
		expect(mocks.updateAgent).toHaveBeenCalledOnce();
		expect(mocks.notifyAgents).not.toHaveBeenCalled();
	});
	it("saving an unchanged configuration does not restart a clarification or invalidate active work", async () => {
		await updateContributionAgent({
			data: { id: "agent", version: 2, action: "configure" },
		});
		expect(mocks.reconcileAgents).not.toHaveBeenCalled();
		expect(mocks.notifyAgents).not.toHaveBeenCalled();
	});
	it("returns only a verified account session", async () => {
		expect(await getContributionSession()).toEqual({ id: "verified" });
	});
	it("authenticates list, detail, catalogue and provider status reads", async () => {
		await getContributions({ data: {} });
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
		await expect(getContributions({ data: {} })).rejects.toThrow();
		expect(mocks.list).not.toHaveBeenCalled();
	});
});
