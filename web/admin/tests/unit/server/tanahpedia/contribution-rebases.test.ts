import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRIBUTION_API_VERSION } from "~/lib/tanahpedia/contribution-api";
import {
	type Contribution,
	reviewStatus,
} from "~/lib/tanahpedia/contributions";

const mocks = vi.hoisted(() => ({
	query: vi.fn(),
	prepare: vi.fn(),
	items: new Map<string, Contribution>(),
}));
vi.mock("~/server/db", () => ({ query: mocks.query }));
vi.mock("~/server/tanahpedia/contribution-changes.server", () => ({
	prepareChanges: mocks.prepare,
}));
vi.mock("~/server/tanahpedia/contribution-store.server", () => ({
	withContributions: async (fn: (c: object) => unknown) => fn({}),
	readContribution: async (_c: object, id: string) =>
		structuredClone(mocks.items.get(id)),
	saveContribution: async (_c: object, item: Contribution) => {
		item.version++;
		mocks.items.set(item.id, structuredClone(item));
		return item;
	},
}));

import {
	refreshPendingContributionBases,
	resumePendingContributionRebases,
} from "~/server/tanahpedia/contribution-rebases.server";

const ID = "00000000-0000-4000-8000-000000000001",
	OTHER = "00000000-0000-4000-8000-000000000002";
let pending: Contribution, trigger: Contribution;
function item(id: string) {
	const value = mocks.items.get(id);
	if (!value) throw new Error("Missing fixture");
	return value;
}
beforeEach(() => {
	vi.resetAllMocks();
	mocks.items.clear();
	const owner = {
		id: "owner",
		name: "doradsoft",
		kind: "human" as const,
		isDoradsoft: true,
	};
	pending = {
		id: ID,
		number: 1,
		kind: "pr",
		state: "open",
		title: "Pending",
		description: "Evidence unchanged",
		author: owner,
		assignee: { kind: "unassigned" },
		evidence: [{ citation: "source", quote: "quote", note: "", url: null }],
		changes: [
			{
				kind: "metadata",
				targetId: ID,
				before: { displayName: "old" },
				after: { displayName: "desired" },
				personNames: [],
				labels: {},
			},
		],
		issueId: null,
		revision: 1,
		version: 1,
		events: [],
		createdAt: "",
		updatedAt: "",
		closeIssue: false,
		provenance: null,
		apiVersion: CONTRIBUTION_API_VERSION,
	};
	trigger = {
		...structuredClone(pending),
		id: OTHER,
		number: 2,
		state: "merged",
		rebasePending: true,
		changes: [{ ...pending.changes[0], after: { displayName: "current" } }],
	};
	mocks.items.set(ID, structuredClone(pending));
	mocks.items.set(OTHER, structuredClone(trigger));
	mocks.prepare.mockResolvedValue([
		{ ...pending.changes[0], before: { displayName: "current" } },
	]);
	mocks.query.mockImplementation(async (sql: string, params: unknown[]) => {
		if (sql.includes("MAX(number)")) return [{ lastNumber: 2 }];
		if (sql.includes("SELECT id,number,data"))
			return params[0] === 0
				? [{ id: ID, number: 1, data: mocks.items.get(ID) }]
				: [];
		if (sql.includes("rebasePending"))
			return params[0] === 0 ? [{ id: OTHER, number: 2 }] : [];
		return [];
	});
});
describe("pending proposal base refresh", () => {
	it("refreshes shared targets even when proposals spell their IDs differently", async () => {
		const id = "Abcdef00-0000-4000-8000-000000000001";
		pending.changes[0].targetId = id;
		trigger.changes[0].targetId = id.toLowerCase();
		mocks.items.set(ID, pending);
		expect((await refreshPendingContributionBases(trigger)).refreshed).toBe(1);
	});
	it("revises the diff and owner-review requirement without changing its intent or evidence", async () => {
		expect(await refreshPendingContributionBases(trigger)).toEqual({
			scanned: 1,
			refreshed: 1,
			blocked: 0,
		});
		const current = item(ID);
		expect(current.changes[0].after).toEqual(pending.changes[0].after);
		expect(current.changes[0].before).toEqual({ displayName: "current" });
		expect(current.evidence).toEqual(pending.evidence);
		expect(current.events[0].snapshot?.changes).toEqual(pending.changes);
		expect(current.revision).toBe(2);
		expect(reviewStatus(current)).toBe("required");
		await refreshPendingContributionBases(trigger);
		expect(mocks.items.get(ID)?.version).toBe(current.version);
	});
	it("retains the original sequence for a missing target and avoids duplicate failure revisions", async () => {
		mocks.prepare.mockRejectedValue(new Error("Target disappeared"));
		expect((await refreshPendingContributionBases(trigger)).blocked).toBe(1);
		const blocked = item(ID);
		expect(blocked.changes).toEqual(pending.changes);
		expect(blocked.domainConflict).toBe("Target disappeared");
		await refreshPendingContributionBases(trigger);
		expect(mocks.items.get(ID)?.version).toBe(blocked.version);
		mocks.prepare.mockResolvedValue(pending.changes);
		await refreshPendingContributionBases(trigger);
		expect(mocks.items.get(ID)?.domainConflict).toBeUndefined();
	});
	it("propagates storage failure so the committed merge marker remains replayable", async () => {
		mocks.prepare.mockRejectedValue(
			Object.assign(new Error("Storage offline"), {
				code: "ER_SERVER_SHUTDOWN",
			}),
		);
		await expect(resumePendingContributionRebases()).rejects.toThrow(
			"Storage offline",
		);
		expect(mocks.items.get(OTHER)?.rebasePending).toBe(true);
		expect(mocks.items.get(ID)?.version).toBe(1);
	});
	it("acknowledges the durable marker only after the pending sequence has refreshed", async () => {
		await resumePendingContributionRebases();
		expect(mocks.items.get(OTHER)?.rebasePending).toBeUndefined();
		expect(mocks.items.get(ID)?.changes[0].before).toEqual({
			displayName: "current",
		});
	});
	it("leaves incompatible API sequences untouched", async () => {
		const old = { ...pending, apiVersion: CONTRIBUTION_API_VERSION + 1 };
		mocks.items.set(ID, old);
		await refreshPendingContributionBases(trigger);
		expect(mocks.prepare).not.toHaveBeenCalled();
		expect(mocks.items.get(ID)).toEqual(old);
	});
	it("scans but does not rewrite unrelated proposals", async () => {
		trigger.changes = [
			{
				kind: "entry",
				targetId: OTHER,
				before: null,
				after: {
					title: "new",
					uniqueName: "new",
					entityType: "PERSON",
					displayName: "new",
				},
				labels: {},
			},
		];
		await refreshPendingContributionBases(trigger);
		expect(mocks.prepare).not.toHaveBeenCalled();
		expect(mocks.items.get(ID)?.version).toBe(1);
	});
});
