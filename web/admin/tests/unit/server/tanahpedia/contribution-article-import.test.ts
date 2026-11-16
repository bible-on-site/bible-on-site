import { beforeEach, expect, it, vi } from "vitest";
import {
	migrationBlocked,
	validateApiSequence,
} from "~/lib/tanahpedia/contribution-api";
import {
	type Contribution,
	reviewStatus,
} from "~/lib/tanahpedia/contributions";

const mocks = vi.hoisted(() => ({
	query: vi.fn(),
	txQuery: vi.fn(),
	one: vi.fn(),
	execute: vi.fn(),
	prepare: vi.fn(),
	insert: vi.fn(),
	ensure: vi.fn(),
	schema: vi.fn(),
	fence: vi.fn(),
	evidence: vi.fn(),
}));
vi.mock("~/server/db", () => ({
	query: mocks.query,
	txQuery: mocks.txQuery,
	txQueryOne: mocks.one,
	txExecute: mocks.execute,
}));
vi.mock("~/server/tanahpedia/contribution-article-links.server", () => ({
	prepareArticleLinkChange: mocks.prepare,
}));
vi.mock("~/server/tanahpedia/contribution-article-evidence.server", () => ({
	refreshArticleLinkEvidence: mocks.evidence,
}));
vi.mock("~/server/tanahpedia/contribution-store.server", () => ({
	ensureContributionSchema: mocks.ensure,
	insertContribution: mocks.insert,
	withContributions: (fn: (conn: unknown) => unknown) => fn({}),
}));
vi.mock("~/server/tanahpedia/contribution-service.server", () => ({
	addEvent: (item: Contribution, actor: unknown, kind: string, body: string) =>
		item.events.push({
			id: `event-${item.events.length}`,
			actor,
			kind,
			body,
			revision: item.revision,
		} as never),
}));
vi.mock(
	"~/server/tanahpedia/contribution-article-import-schema.server",
	() => ({ ensureArticleLinkStatusFence: mocks.fence }),
);
vi.mock("~/server/article-link-pipeline", () => ({
	ensureLinkSchema: mocks.schema,
}));

import {
	articleLinkContributionIds,
	importLegacyArticleLinkProposals,
	legacyArticleLinkContribution,
	promoteLegacyArticleLinkProposals,
} from "~/server/tanahpedia/contribution-article-import.server";

const base = {
	contentHash: "a".repeat(32),
	sourceHash: "b".repeat(64),
	perekId: 1,
	authorId: 7,
	coverageVerified: false,
	coveringSources: [],
	dedicationAssignments: [],
	moedIds: [],
};
const row = (id = "proposal-1", extra = {}) => ({
	id,
	article_id: 123,
	status: "pending",
	relationship_key: "primaryPerek",
	action: "replace",
	target_json: { perekId: 2 },
	review_patch_json: null,
	base_content_hash: base.contentHash,
	evidence_json: [{ quote: "ציטוט", spanStart: 0, spanEnd: 5 }],
	generator: "heuristic:v1",
	prompt_version: "v1",
	run_id: "run-1",
	model: null,
	decision_key: "same-decision",
	dedupe_key: id,
	reviewer: null,
	review_notes: null,
	prompt_tokens: 123,
	completion_tokens: 45,
	...extra,
});
beforeEach(() => {
	vi.resetAllMocks();
	mocks.txQuery.mockResolvedValue([row()]);
	mocks.one.mockResolvedValue({ article_id: 123 });
	mocks.execute.mockResolvedValue({ affectedRows: 1 });
	mocks.fence.mockResolvedValue([]);
	mocks.query.mockResolvedValue([]);
	mocks.prepare.mockImplementation(async (_conn, input) => ({
		...input,
		before: base,
		labels: { "article:123": "מאמר" },
	}));
	mocks.evidence.mockImplementation(async (_conn, item) => item.evidence);
	mocks.insert.mockImplementation(async (_conn, item) => ({
		...item,
		number: 42,
	}));
});
it("groups persisted identities by article and preserves every original audit independently", async () => {
	const first = row(),
		second = row("proposal-2", {
			target_json: JSON.stringify({ perekId: 2 }),
			generator: "different-model",
		});
	mocks.txQuery.mockResolvedValue([first, second]);
	const ids = await promoteLegacyArticleLinkProposals({} as never, 123);
	expect(ids).toHaveLength(1);
	const item = mocks.insert.mock.calls[0][1] as Contribution;
	expect(item.legacyArticleLinks).toEqual({
		articleId: 123,
		proposalIds: [first.id, second.id],
	});
	expect(item.changes[0].after?.commands).toHaveLength(1);
	expect(validateApiSequence(item.changes)).toEqual(item.changes);
	expect(item.author).toMatchObject({ kind: "system", isDoradsoft: false });
	expect(reviewStatus(item)).toBe("required");
	const prose = JSON.stringify({
		description: item.description,
		evidence: item.evidence.map(({ citation, quote, note }) => ({
			citation,
			quote,
			note,
		})),
	});
	for (const technical of [
		first.id,
		second.id,
		"run-1",
		"heuristic:v1",
		"UTF-16",
		base.contentHash,
	])
		expect(prose).not.toContain(technical);
	expect(item.evidence[0].citation).toBe("מאמר (מאמר 123)");
	const snapshots = mocks.execute.mock.calls.filter(([, sql]) =>
		String(sql).startsWith("INSERT INTO tanahpedia_article_link_import "),
	);
	expect(snapshots.map(([, , params]) => JSON.parse(params[3]))).toEqual([
		first,
		second,
	]);
});
it("uses human reviewPatch without overwriting original target or trusting a historical owner-looking name", async () => {
	const original = row("id", {
		status: "approved",
		reviewer: "doradsoft",
		review_patch_json: JSON.stringify({ perekId: 3 }),
		review_notes: "Prior reviewer note",
	});
	mocks.txQuery.mockResolvedValue([original]);
	await promoteLegacyArticleLinkProposals({} as never, 123);
	const item = mocks.insert.mock.calls[0][1] as Contribution;
	expect(item.changes[0].after?.commands).toEqual([
		{
			relationshipKey: "primaryPerek",
			action: "replace",
			target: { perekId: 3 },
		},
	]);
	expect(reviewStatus(item)).toBe("required");
	expect(item.events.some((e) => e.kind === "approved")).toBe(false);
	expect(item.description).toContain("Prior reviewer note");
	expect(original.target_json).toEqual({ perekId: 2 });
});
it.each(["held", "stale"])(
	"keeps %s proposals open and blocked for fresh human repair",
	async (status) => {
		mocks.txQuery.mockResolvedValue([row("id", { status })]);
		await promoteLegacyArticleLinkProposals({} as never, 123);
		expect(mocks.insert.mock.calls[0][1]).toMatchObject({
			state: "open",
			domainConflict: expect.any(String),
		});
	},
);
it("keeps outdated evidence blocked even when commands can be translated", async () => {
	mocks.txQuery.mockResolvedValue([
		row("id", { base_content_hash: "c".repeat(32) }),
	]);
	await promoteLegacyArticleLinkProposals({} as never, 123);
	expect(mocks.insert.mock.calls[0][1].domainConflict).toBeTruthy();
});
it.each(["author", "mentionAnnotations", "hebrewDates"])(
	"preserves unsupported %s operations as gray raw PRs",
	async (relationship_key) => {
		mocks.txQuery.mockResolvedValue([row("id", { relationship_key })]);
		await promoteLegacyArticleLinkProposals({} as never, 123);
		const item = mocks.insert.mock.calls[0][1] as Contribution;
		expect(migrationBlocked(item)).toBe(true);
		expect(item.apiMigration?.sequence).toContain(relationship_key);
		expect(item.apiMigration?.sequence).toContain("legacyProposals");
		expect(mocks.prepare).not.toHaveBeenCalled();
	},
);
it("keeps malformed original JSON available for repair while returning a fixed error", async () => {
	mocks.txQuery.mockResolvedValue([
		row("id", { target_json: '{"sensitiveFixture":"unfinished' }),
	]);
	await promoteLegacyArticleLinkProposals({} as never, 123);
	const item = mocks.insert.mock.calls[0][1] as Contribution;
	expect(item.apiMigration?.error).toBe(
		"Legacy proposal contains invalid JSON; the original record is preserved for manual recovery",
	);
	expect(item.apiMigration?.sequence).toContain("sensitiveFixture");
});
it("creates historical merged and closed PRs without replaying content or manufacturing approvals", async () => {
	mocks.txQuery.mockResolvedValue([
		row("applied", { status: "applied" }),
		row("rejected", { status: "rejected" }),
	]);
	await promoteLegacyArticleLinkProposals({} as never, 123);
	const items = mocks.insert.mock.calls.map(([, item]) => item as Contribution);
	expect(items.map((item) => item.state)).toEqual(["merged", "closed"]);
	expect(
		items.every((item) => item.events.every((e) => e.kind !== "approved")),
	).toBe(true);
	expect(mocks.evidence).not.toHaveBeenCalled();
});
it("retries identity import without creating another PR after the persisted mapping exists", async () => {
	await promoteLegacyArticleLinkProposals({} as never, 123);
	mocks.txQuery.mockResolvedValue([]);
	expect(await promoteLegacyArticleLinkProposals({} as never, 123)).toEqual([]);
	expect(mocks.insert).toHaveBeenCalledTimes(1);
	expect(mocks.one.mock.calls[0][1]).toContain("FOR UPDATE");
});
it("batches large histories without dropping identities", async () => {
	mocks.txQuery.mockResolvedValue(
		Array.from({ length: 41 }, (_, i) => row(`id-${i}`)),
	);
	expect(
		await promoteLegacyArticleLinkProposals({} as never, 123),
	).toHaveLength(2);
	expect(
		mocks.insert.mock.calls.map(
			([, item]) => item.legacyArticleLinks.proposalIds.length,
		),
	).toEqual([40, 1]);
});
it("propagates storage and audit-marker failure to roll back the caller transaction", async () => {
	const unavailable = Object.assign(new Error("DB unavailable"), {
		code: "ER_LOCK_DEADLOCK",
	});
	mocks.prepare.mockRejectedValue(unavailable);
	await expect(
		promoteLegacyArticleLinkProposals({} as never, 123),
	).rejects.toBe(unavailable);
	expect(mocks.insert).not.toHaveBeenCalled();
	mocks.prepare.mockResolvedValue({ ...row(), before: base });
	mocks.execute.mockRejectedValueOnce(unavailable);
	await expect(
		promoteLegacyArticleLinkProposals({} as never, 123),
	).rejects.toBe(unavailable);
});
it("backfills all keyset pages after ensuring schema outside data transactions", async () => {
	mocks.query
		.mockResolvedValueOnce([{ articleId: 123 }])
		.mockResolvedValueOnce([{ articleId: 456 }])
		.mockResolvedValueOnce([]);
	const result = await importLegacyArticleLinkProposals();
	expect(result.articles).toBe(2);
	expect(result.prIds).toHaveLength(2);
	expect(mocks.schema).toHaveBeenCalledOnce();
	expect(mocks.ensure).toHaveBeenCalledOnce();
	expect(mocks.query.mock.calls.map(([, params]) => params)).toEqual([
		[0],
		[123],
		[456],
	]);
});
it("returns stable ordinary PRs for old URLs and repeated checkpoint requests", async () => {
	mocks.query
		.mockResolvedValueOnce([{ articleId: 123 }])
		.mockResolvedValueOnce([{ id: "pr", number: 42, state: "open" }]);
	expect(await legacyArticleLinkContribution("proposal-1")).toEqual({
		id: "pr",
		number: 42,
		state: "open",
	});
	mocks.query.mockResolvedValue([{ id: "pr" }]);
	expect(await articleLinkContributionIds([123])).toEqual(["pr"]);
	expect(await articleLinkContributionIds([])).toEqual([]);
	mocks.query.mockResolvedValue([]);
	expect(await legacyArticleLinkContribution("missing")).toBeNull();
});

it("resolves an exact unique legacy moed name without inventing an ID and retains its original token", async () => {
	const original = row("moed", {
		relationship_key: "moadim",
		action: "add",
		target_json: { moedName: "סוכות" },
	});
	mocks.txQuery.mockImplementation(async (_conn, sql: string) =>
		sql.includes("FROM tanah_moed") ? [{ id: 12 }] : [original],
	);
	await promoteLegacyArticleLinkProposals({} as never, 123);
	expect(mocks.prepare.mock.calls[0][1].after.commands).toEqual([
		{ relationshipKey: "moadim", action: "add", target: { moedIds: [12] } },
	]);
	expect(original.target_json).toEqual({ moedName: "סוכות" });
});
it.each([{ matches: [] }, { matches: [{ id: 12 }, { id: 13 }] }])(
	"keeps missing/ambiguous legacy moed lookup recoverable: %j",
	async ({ matches }) => {
		mocks.txQuery.mockImplementation(async (_conn, sql: string) =>
			sql.includes("FROM tanah_moed")
				? matches
				: [
						row("moed", {
							relationship_key: "moadim",
							action: "add",
							target_json: { moedName: "סוכות" },
						}),
					],
		);
		await promoteLegacyArticleLinkProposals({} as never, 123);
		expect(mocks.insert.mock.calls[0][1].apiMigration).toMatchObject({
			status: "failed",
			error: expect.stringContaining("missing or ambiguous"),
		});
	},
);
it("normalizes known legacy UTC expiry formats without overwriting the archived input", async () => {
	const original = row("expiry", {
		relationship_key: "dedicationAssignments",
		action: "add",
		target_json: { dedicationId: 9, expiresAt: "2027-01-01T12:30" },
	});
	mocks.txQuery.mockResolvedValue([original]);
	await promoteLegacyArticleLinkProposals({} as never, 123);
	expect(
		mocks.prepare.mock.calls[0][1].after.commands[0].target.expiresAt,
	).toBe("2027-01-01 12:30:00");
	expect(original.target_json).toEqual({
		dedicationId: 9,
		expiresAt: "2027-01-01T12:30",
	});
});

it("initializes the old-server fence once concurrently and retries an actual DDL failure", async () => {
	vi.resetModules();
	mocks.ensure.mockClear();
	mocks.schema.mockClear();
	mocks.fence.mockReset();
	const unavailable = Object.assign(new Error("ALTER privilege unavailable"), {
		code: "ER_SPECIFIC_ACCESS_DENIED_ERROR",
	});
	mocks.fence.mockRejectedValueOnce(unavailable);
	const module = await import(
		"~/server/tanahpedia/contribution-article-import.server"
	);
	const outcomes = await Promise.allSettled([
		module.ensureArticleLinkPromotionSchema(),
		module.ensureArticleLinkPromotionSchema(),
	]);
	expect(
		outcomes.every(
			(outcome) =>
				outcome.status === "rejected" && outcome.reason === unavailable,
		),
	).toBe(true);
	expect(mocks.fence).toHaveBeenCalledTimes(1);
	mocks.fence.mockResolvedValue([]);
	await module.ensureArticleLinkPromotionSchema();
	await module.ensureArticleLinkPromotionSchema();
	expect(mocks.fence).toHaveBeenCalledTimes(2);
	expect(mocks.fence).toHaveBeenLastCalledWith();
	expect(mocks.ensure).toHaveBeenCalledTimes(2);
	expect(mocks.schema).toHaveBeenCalledTimes(2);
});
