import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	CONTRIBUTION_API_VERSION,
	migrationBlocked,
	validateApiSequence,
} from "~/lib/tanahpedia/contribution-api";
import {
	assertMergeAllowed,
	type Contribution,
	type ReviewedChange,
	reviewStatus,
} from "~/lib/tanahpedia/contributions";

const mocks = vi.hoisted(() => ({
	query: vi.fn(),
	ensure: vi.fn(),
	read: vi.fn(),
	save: vi.fn(),
}));
vi.mock("~/server/db", () => ({ query: mocks.query }));
vi.mock("~/server/tanahpedia/contribution-store.server", () => ({
	ensureContributionSchema: mocks.ensure,
	readContribution: mocks.read,
	saveContribution: mocks.save,
	withContributions: async (fn: (conn: object) => Promise<unknown>) => fn({}),
}));

import {
	ensureContributionMigrationsStarted,
	migrateContributionSequence,
	migrateOpenContributionPrs,
} from "~/server/tanahpedia/contribution-migrations.server";

const id = "00000000-0000-4000-8000-000000000001";
const author = {
	id: "alice",
	name: "Alice",
	kind: "human" as const,
	isDoradsoft: false,
};
const owner = { ...author, id: "owner", name: "doradsoft", isDoradsoft: true };
const changes: ReviewedChange[] = [
	{
		kind: "metadata",
		targetId: id,
		before: { displayName: "old" },
		after: { displayName: "new" },
		labels: {},
		personNames: [],
	},
];
function pr(): Contribution {
	return {
		id,
		number: 1,
		kind: "pr",
		apiVersion: CONTRIBUTION_API_VERSION,
		state: "open",
		title: "Test",
		description: "Test",
		author,
		assignee: { kind: "unassigned" },
		evidence: [{ citation: "בראשית א א", quote: "", url: null, note: "" }],
		changes: structuredClone(changes),
		issueId: null,
		revision: 4,
		version: 7,
		events: [
			{
				id: "review",
				kind: "approved",
				actor: owner,
				body: "approved",
				at: "2026-11-14T00:00:00.000Z",
				revision: 4,
			},
		],
		createdAt: "2026-11-14T00:00:00.000Z",
		updatedAt: "2026-11-14T00:00:00.000Z",
		closeIssue: false,
		provenance: null,
	};
}
beforeEach(() => vi.clearAllMocks());
describe("pending PR API migration", () => {
	it("propagates a database failure from an asynchronous adapter without marking the PR incompatible", async () => {
		const item = pr();
		item.apiVersion = 1;
		await expect(
			migrateContributionSequence(item, {
				version: CONTRIBUTION_API_VERSION,
				adapters: [
					{
						from: 1,
						to: CONTRIBUTION_API_VERSION,
						id: "lookup",
						convert: async () => {
							throw Object.assign(new Error("Storage unavailable"), {
								code: "ER_SERVER_SHUTDOWN",
							});
						},
					},
				],
			}),
		).rejects.toThrow("Storage unavailable");
		expect(item.apiMigration).toBeUndefined();
		expect(item.apiVersion).toBe(1);
	});
	it("composes adapters while preserving approval, revision, base state and raw original", async () => {
		const item = pr();
		item.apiVersion = 4;
		const original = structuredClone(item);
		expect(
			await migrateContributionSequence(item, {
				version: CONTRIBUTION_API_VERSION,
				adapters: [
					{ from: 4, to: 3, id: "first", convert: (p) => p },
					{
						from: 3,
						to: CONTRIBUTION_API_VERSION,
						id: "second",
						convert: (p) => p,
					},
				],
			}),
		).toBe("migrated");
		expect(item.apiVersion).toBe(CONTRIBUTION_API_VERSION);
		expect(item.revision).toBe(4);
		expect(item.events).toEqual(original.events);
		expect(reviewStatus(item)).toBe("approved");
		expect(() => assertMergeAllowed(item)).not.toThrow();
		expect(item.apiMigration?.steps.map((s) => s.id)).toEqual([
			"first",
			"second",
		]);
		expect(JSON.parse(item.apiMigration?.sequence ?? "null")).toEqual(
			original.changes,
		);
	});
	it("permits an adapter to drop retired fields and operations without invalidating approval", async () => {
		const item = pr();
		item.apiVersion = 3;
		expect(
			await migrateContributionSequence(item, {
				version: CONTRIBUTION_API_VERSION,
				adapters: [
					{
						from: 3,
						to: CONTRIBUTION_API_VERSION,
						id: "remove-operation",
						convert: () => [],
					},
				],
			}),
		).toBe("migrated");
		expect(item.changes).toEqual([]);
		expect(() => assertMergeAllowed(item)).not.toThrow();
		expect(reviewStatus(item)).toBe("approved");
	});
	it("keeps the entire plain sequence and approval on conversion failure", async () => {
		const item = pr(),
			original = structuredClone(item);
		item.apiVersion = 3;
		expect(await migrateContributionSequence(item)).toBe("failed");
		expect(migrationBlocked(item)).toBe(true);
		expect(item.changes).toEqual(original.changes);
		expect(item.events).toEqual(original.events);
		expect(item.revision).toBe(4);
		expect(item.apiMigration?.error).toContain("No supported conversion");
		expect(() => assertMergeAllowed(item)).toThrow("Couldn't migrate");
		expect(await migrateContributionSequence(item)).toBe("unchanged");
		expect(item.apiMigrationHistory).toHaveLength(1);
	});
	it("marks invalid adapter output gray and can recover on a later successful deployment", async () => {
		const item = pr();
		item.apiVersion = 3;
		await migrateContributionSequence(item, {
			version: CONTRIBUTION_API_VERSION,
			adapters: [
				{
					from: 3,
					to: CONTRIBUTION_API_VERSION,
					id: "bad",
					convert: () => [{ kind: "removed" }],
				},
			],
		});
		expect(migrationBlocked(item)).toBe(true);
		expect(item.apiVersion).toBe(3);
		expect(
			await migrateContributionSequence(item, {
				version: CONTRIBUTION_API_VERSION,
				adapters: [
					{
						from: 3,
						to: CONTRIBUTION_API_VERSION,
						id: "fixed",
						convert: (p) => p,
					},
				],
			}),
		).toBe("migrated");
		expect(migrationBlocked(item)).toBe(false);
		expect(item.apiMigrationHistory).toHaveLength(2);
		expect(reviewStatus(item)).toBe("approved");
	});
	it("handles thrown non-Error adapters without discarding original input", async () => {
		const item = pr();
		item.apiVersion = 3;
		await migrateContributionSequence(item, {
			version: CONTRIBUTION_API_VERSION,
			adapters: [
				{
					from: 3,
					to: CONTRIBUTION_API_VERSION,
					id: "broken",
					convert: () => {
						throw null;
					},
				},
			],
		});
		expect(item.apiMigration?.status).toBe("failed");
		expect(item.changes).toEqual(changes);
	});
	it("skips issues and finalized PRs and leaves valid current PRs untouched", async () => {
		for (const item of [
			{ ...pr(), kind: "issue" as const },
			{ ...pr(), state: "closed" as const },
			{ ...pr(), state: "merged" as const },
			pr(),
		]) {
			expect(await migrateContributionSequence(item)).toBe("unchanged");
			expect(item.apiMigration).toBeUndefined();
		}
	});
	it("validates converted bases, targets, labels and both sides rather than silently dropping fields", async () => {
		expect(validateApiSequence(changes)).toEqual(changes);
		expect(validateApiSequence([])).toEqual([]);
		for (const sequence of [
			null,
			Array(41).fill(changes[0]),
			[...changes, ...changes],
			[{ ...changes[0], before: undefined }],
			[{ ...changes[0], after: { displayName: "new", retired: 1 } }],
			[{ ...changes[0], before: { displayName: "old", retired: 1 } }],
			[{ ...changes[0], labels: { bad: 7 } }],
			[
				{
					...changes[0],
					kind: "entry",
					before: { title: "old" },
					after: {
						title: "T",
						uniqueName: "T",
						entityType: "PERSON",
						displayName: "T",
					},
				},
			],
		])
			expect(() => validateApiSequence(sequence)).toThrow();
	});
	it("retains validated main-name preconditions across API conversion", async () => {
		const names = [
			{ id: "00000000-0000-4000-8000-000000000003", name: "Main name" },
		];
		expect(
			validateApiSequence([{ ...changes[0], personNames: names }])[0]
				.personNames,
		).toEqual(names);
		for (const personNames of [
			null,
			{},
			[...names, ...names],
			[{ ...names[0], id: "bad" }],
			[{ ...names[0], name: 4 }],
			Array(101).fill(names[0]),
		])
			expect(() =>
				validateApiSequence([{ ...changes[0], personNames }]),
			).toThrow();
	});
	it("scans beyond 500 UI rows, locks each open PR and persists only changes", async () => {
		const rows = Array.from({ length: 501 }, (_, i) => ({
			id: String(i + 1),
			number: i + 1,
		}));
		mocks.query.mockImplementation(async (sql: string, params?: number[]) =>
			sql.includes("MAX(number)")
				? [{ lastNumber: 501 }]
				: rows.filter((r) => r.number > (params?.[0] ?? 0)).slice(0, 100),
		);
		mocks.read.mockImplementation(async (_conn: object, rowId: string) => ({
			...pr(),
			id: rowId,
			apiVersion: 3,
		}));
		const result = await migrateOpenContributionPrs({
			version: CONTRIBUTION_API_VERSION,
			adapters: [
				{
					from: 3,
					to: CONTRIBUTION_API_VERSION,
					id: "upgrade",
					convert: (p) => p,
				},
			],
		});
		expect(result).toMatchObject({ scanned: 501, migrated: 501, failed: 0 });
		expect(mocks.save).toHaveBeenCalledTimes(501);
		expect(mocks.read).toHaveBeenCalledWith({}, "501", true);
	});
	it("continues conversion failures but propagates storage errors for CD retry", async () => {
		mocks.query
			.mockResolvedValueOnce([{ lastNumber: 2 }])
			.mockResolvedValueOnce([
				{ id: "1", number: 1 },
				{ id: "2", number: 2 },
			]);
		mocks.read
			.mockResolvedValueOnce({ ...pr(), apiVersion: 3 })
			.mockResolvedValueOnce(pr());
		expect(await migrateOpenContributionPrs()).toMatchObject({
			scanned: 2,
			failed: 1,
			unchanged: 1,
		});
		mocks.query
			.mockResolvedValueOnce([{ lastNumber: 1 }])
			.mockRejectedValueOnce(new Error("database unavailable"));
		await expect(migrateOpenContributionPrs()).rejects.toThrow(
			"database unavailable",
		);
	});
	it("startup runs once and reports infrastructure failure without an unhandled rejection", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		mocks.ensure.mockRejectedValueOnce(new Error("unavailable"));
		ensureContributionMigrationsStarted();
		await vi.waitFor(() => expect(log).toHaveBeenCalled());
		mocks.ensure.mockResolvedValue(undefined);
		mocks.query.mockResolvedValue([{ lastNumber: 0 }]);
		ensureContributionMigrationsStarted();
		await vi.waitFor(() => expect(mocks.query).toHaveBeenCalled());
		const calls = mocks.ensure.mock.calls.length;
		ensureContributionMigrationsStarted();
		expect(mocks.ensure).toHaveBeenCalledTimes(calls);
		log.mockRestore();
	});
});
