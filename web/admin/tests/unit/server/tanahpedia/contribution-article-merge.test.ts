import { beforeEach, expect, it, vi } from "vitest";
import {
	type ArticleLinkCommand,
	type ArticleLinkState,
	projectArticleLinks,
} from "~/lib/tanahpedia/contribution-article-links";
import type { ChangeState, Contribution } from "~/lib/tanahpedia/contributions";
import {
	applyReviewedArticleLinks,
	assertArticleLinkMergeBase,
	assertNoArticleLinkMerge,
	invalidateMergedArticleLinks,
	isArticleLinkPr,
} from "~/server/tanahpedia/contribution-article-merge.server";

const deps = vi.hoisted(() => ({
	read: vi.fn(),
	update: vi.fn(),
	dedication: vi.fn(),
	owners: vi.fn(),
	evidence: vi.fn(),
	revalidate: vi.fn(),
	sync: vi.fn(),
}));
vi.mock("~/server/tanahpedia/contribution-article-links.server", () => ({
	readArticleLinkState: deps.read,
}));
vi.mock("~/server/article-relationships-api", () => ({
	updateArticleRelationships: deps.update,
}));
vi.mock("~/server/dedication-targets.server", () => ({
	setReviewedArticleDedicationTarget: deps.dedication,
	lockReviewedArticleDedicationOwners: deps.owners,
}));
vi.mock("~/server/tanahpedia/contribution-article-evidence.server", () => ({
	refreshArticleLinkEvidence: deps.evidence,
}));
vi.mock("~/server/dedication-expiry", () => ({
	syncDedicationExpiry: deps.sync,
}));
vi.mock("~/server/website-revalidate", () => ({
	articleChange: (value: unknown) => ({ kind: "article", value }),
	dedicationChange: (value: unknown) => ({ kind: "dedication", value }),
	revalidateWebsite: deps.revalidate,
}));

const conn = {} as never;
const initial = (): ArticleLinkState => ({
	contentHash: "a".repeat(32),
	sourceHash: "b".repeat(64),
	perekId: 1,
	authorId: 7,
	coverageVerified: true,
	coveringSources: [{ perekId: 1, pasuk: 2 }],
	dedicationAssignments: [
		{ dedicationId: 9, expiresAt: "2027-01-01 00:00:00" },
	],
	moedIds: [2],
});
const commands: ArticleLinkCommand[] = [
	{
		relationshipKey: "primaryPerek",
		action: "replace",
		target: { perekId: 3 },
	},
	{
		relationshipKey: "coveringSources",
		action: "replace",
		target: {
			pasukCoordinates: [{ perekId: 3, pasuk: 4 }],
			coverageVerified: false,
		},
	},
	{ relationshipKey: "moadim", action: "add", target: { moedIds: [5] } },
	{
		relationshipKey: "dedicationAssignments",
		action: "replace",
		target: { dedicationId: 9, expiresAt: null },
	},
	{
		relationshipKey: "dedicationAssignments",
		action: "add",
		target: { dedicationId: 10, expiresAt: "2028-02-01 01:02:03" },
	},
];
function pr(operations = commands): Contribution {
	return {
		id: "pr-id",
		number: 42,
		kind: "pr",
		state: "open",
		title: "Links",
		description: "Reviewed link intent",
		author: {
			id: "reviewer",
			name: "Reviewer",
			kind: "human",
			isDoradsoft: true,
		},
		assignee: { kind: "unassigned" },
		evidence: [],
		changes: [
			{
				kind: "article_links",
				targetId: "123",
				before: structuredClone(initial()) as unknown as ChangeState,
				after: {
					commands: structuredClone(operations),
				} as unknown as ChangeState,
				labels: {},
			},
		],
		issueId: null,
		revision: 3,
		version: 6,
		events: [],
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		closeIssue: false,
		provenance: null,
		articleLinkMerge: {
			id: "durable-intent",
			revision: 3,
			startedAt: "2026-01-01T00:00:00Z",
		},
	};
}
let live: ArticleLinkState;
let order: string[];
beforeEach(() => {
	vi.resetAllMocks();
	live = initial();
	order = [];
	deps.read.mockImplementation(async (_conn, _id, options) => {
		order.push(options?.current ? "current" : "snapshot");
		return structuredClone(live);
	});
	deps.evidence.mockImplementation(
		async (_conn, item: Contribution) => item.evidence,
	);
	deps.update.mockImplementation(async (_id, next) => {
		order.push("api");
		live = {
			...live,
			contentHash: "c".repeat(32),
			perekId: next.perekId,
			coveringSources: next.coveringSources,
			coverageVerified: next.coverageVerified,
			moedIds: next.moedIds,
		};
	});
	deps.dedication.mockImplementation(async () => {
		order.push("dedication");
	});
	deps.owners.mockImplementation(async () => {
		order.push("owner-locks");
	});
});

it("applies the reviewed API projection before locking the current state and editing dedication targets", async () => {
	await applyReviewedArticleLinks(conn, pr());
	expect(order).toEqual([
		"snapshot",
		"api",
		"owner-locks",
		"current",
		"dedication",
		"dedication",
	]);
	expect(deps.update).toHaveBeenCalledExactlyOnceWith(123, {
		source: "contribution-pr:42:durable-intent",
		expectedContentHash: "a".repeat(32),
		expectedCoveringSources: [{ perekId: 1, pasuk: 2 }],
		expectedMoedIds: [2],
		expectedCoverageVerified: true,
		perekId: 3,
		coveringSources: [{ perekId: 3, pasuk: 4 }],
		coverageVerified: false,
		moedIds: [2, 5],
	});
	expect(deps.read.mock.calls).toEqual([
		[conn, "123"],
		[conn, "123", { current: true }],
	]);
	expect(deps.owners).toHaveBeenCalledExactlyOnceWith(conn, [9, 10]);
	expect(deps.dedication.mock.calls).toEqual([
		[
			conn,
			{
				articleId: 123,
				dedicationId: 9,
				before: initial().dedicationAssignments[0],
				after: { dedicationId: 9, expiresAt: null },
			},
		],
		[
			conn,
			{
				articleId: 123,
				dedicationId: 10,
				before: null,
				after: { dedicationId: 10, expiresAt: "2028-02-01 01:02:03" },
			},
		],
	]);
	expect(deps.revalidate).not.toHaveBeenCalled();
	expect(deps.sync).not.toHaveBeenCalled();
});

it("resumes a lost API response from the exact reviewed projection without repeating the API write", async () => {
	const commit = deps.update.getMockImplementation();
	deps.update.mockImplementationOnce(async (...args) => {
		await commit?.(...args);
		throw new Error("Response interrupted after commit");
	});
	const item = pr();
	await expect(applyReviewedArticleLinks(conn, item)).rejects.toThrow(
		"Response interrupted after commit",
	);
	expect(deps.dedication).not.toHaveBeenCalled();
	await applyReviewedArticleLinks(conn, item);
	expect(deps.update).toHaveBeenCalledTimes(1);
	expect(deps.dedication).toHaveBeenCalledTimes(2);
	expect(order).toEqual([
		"snapshot",
		"api",
		"snapshot",
		"owner-locks",
		"current",
		"dedication",
		"dedication",
	]);
});

it.each([
	["source", { sourceHash: "d".repeat(64) }],
	["author", { authorId: 8 }],
	["covering set", { coveringSources: [{ perekId: 9, pasuk: 1 }] }],
	["moed set", { moedIds: [8] }],
	[
		"dedication expiry",
		{ dedicationAssignments: [{ dedicationId: 9, expiresAt: null }] },
	],
])(
	"refuses a changed %s before any API or dedication write",
	async (_name, changed) => {
		live = { ...live, ...changed };
		await expect(applyReviewedArticleLinks(conn, pr())).rejects.toThrow(
			"cannot be recovered",
		);
		expect(deps.update).not.toHaveBeenCalled();
		expect(deps.dedication).not.toHaveBeenCalled();
	},
);

it("does not treat an already-applied projection with a changed dedication expiry as a recoverable response", async () => {
	live = {
		...projectArticleLinks(initial(), { commands }),
		contentHash: "e".repeat(32),
	};
	await expect(applyReviewedArticleLinks(conn, pr())).rejects.toThrow(
		"cannot be recovered",
	);
	expect(deps.update).not.toHaveBeenCalled();
	expect(deps.dedication).not.toHaveBeenCalled();
});

it.each([
	{ sourceHash: "d".repeat(64) },
	{ moedIds: [2, 5, 8] },
	{ dedicationAssignments: [{ dedicationId: 9, expiresAt: null }] },
])("fences concurrent canonical edits observed after HTTP", async (changed) => {
	const commit = deps.update.getMockImplementation();
	deps.update.mockImplementationOnce(async (...args) => {
		await commit?.(...args);
		live = { ...live, ...changed };
	});
	await expect(applyReviewedArticleLinks(conn, pr())).rejects.toThrow(
		"changed during its API merge",
	);
	expect(deps.dedication).not.toHaveBeenCalled();
});

it("keeps dedication-only edits local and skips unchanged assignments", async () => {
	await applyReviewedArticleLinks(
		conn,
		pr([
			{
				relationshipKey: "dedicationAssignments",
				action: "add",
				target: { dedicationId: 10, expiresAt: null },
			},
		]),
	);
	expect(order).toEqual(["snapshot", "owner-locks", "current", "dedication"]);
	expect(deps.update).not.toHaveBeenCalled();
	expect(deps.dedication).toHaveBeenCalledExactlyOnceWith(conn, {
		articleId: 123,
		dedicationId: 10,
		before: null,
		after: { dedicationId: 10, expiresAt: null },
	});
});

it("removes only the reviewed dedication assignment", async () => {
	await applyReviewedArticleLinks(
		conn,
		pr([
			{
				relationshipKey: "dedicationAssignments",
				action: "remove",
				target: { dedicationId: 9, expiresAt: null },
			},
		]),
	);
	expect(deps.dedication).toHaveBeenCalledExactlyOnceWith(conn, {
		articleId: 123,
		dedicationId: 9,
		before: initial().dedicationAssignments[0],
		after: null,
	});
});

it("propagates an API rejection before dedication edits or cache invalidation", async () => {
	deps.update.mockRejectedValueOnce(new Error("API conflict"));
	await expect(applyReviewedArticleLinks(conn, pr())).rejects.toThrow(
		"API conflict",
	);
	expect(deps.read).toHaveBeenCalledTimes(1);
	expect(deps.owners).not.toHaveBeenCalled();
	expect(deps.dedication).not.toHaveBeenCalled();
	expect(deps.revalidate).not.toHaveBeenCalled();
});

it("requires every reviewed dedication owner before locking child state after HTTP", async () => {
	deps.owners.mockRejectedValueOnce(
		new Error("Referenced dedication does not exist"),
	);
	await expect(applyReviewedArticleLinks(conn, pr())).rejects.toThrow(
		"dedication does not exist",
	);
	expect(deps.update).toHaveBeenCalledTimes(1);
	expect(deps.read).toHaveBeenCalledTimes(1);
	expect(deps.dedication).not.toHaveBeenCalled();
});

it.each([undefined, { id: "old", revision: 2, startedAt: "old" }])(
	"requires the durable intent for this reviewed revision",
	async (intent) => {
		const item = pr();
		item.articleLinkMerge = intent;
		await expect(applyReviewedArticleLinks(conn, item)).rejects.toThrow(
			"durable reviewed intent",
		);
		expect(deps.read).not.toHaveBeenCalled();
	},
);

it("recognizes only a single article aggregate and blocks edits while its intent remains open", async () => {
	const item = pr();
	expect(isArticleLinkPr(item)).toBe(true);
	expect(() => assertNoArticleLinkMerge(item)).toThrow("merge is pending");
	item.state = "merged";
	expect(() => assertNoArticleLinkMerge(item)).not.toThrow();
	item.changes.push(item.changes[0]);
	expect(isArticleLinkPr(item)).toBe(false);
	await expect(applyReviewedArticleLinks(conn, item)).rejects.toThrow(
		"durable reviewed intent",
	);
	item.changes = [];
	expect(isArticleLinkPr(item)).toBe(false);
});

it("checks a current locked base and structured evidence before starting a durable merge", async () => {
	const item = pr();
	await assertArticleLinkMergeBase(conn, item);
	expect(deps.read).toHaveBeenCalledExactlyOnceWith(conn, "123", {
		current: true,
	});
	expect(deps.evidence).toHaveBeenCalledExactlyOnceWith(conn, item);
	live.sourceHash = "d".repeat(64);
	await expect(assertArticleLinkMergeBase(conn, item)).rejects.toThrow(
		"links or source text changed",
	);
	live = initial();
	deps.evidence.mockResolvedValueOnce([{ citation: "Changed evidence" }]);
	await expect(assertArticleLinkMergeBase(conn, item)).rejects.toThrow(
		"structured article evidence changed",
	);
});

it("invalidates old and current article routes plus every affected dedication only at the caller's postcommit step", async () => {
	await applyReviewedArticleLinks(conn, pr());
	expect(deps.revalidate).not.toHaveBeenCalled();
	await invalidateMergedArticleLinks(pr());
	expect(deps.revalidate).toHaveBeenCalledExactlyOnceWith([
		{
			kind: "article",
			value: {
				id: 123,
				perekIds: [1, 3],
				authorIds: [7],
				coveringSpans: [{ perekId: 1, pasukFrom: 2, pasukTo: 2 }],
			},
		},
		{ kind: "dedication", value: { id: 9, articleIds: [123] } },
		{ kind: "dedication", value: { id: 10, articleIds: [123] } },
	]);
	expect(deps.sync.mock.calls.map(([id]) => id)).toEqual([9, 10]);
});

it("does not hide a postcommit invalidation failure or continue expiry sync after it", async () => {
	deps.revalidate.mockRejectedValueOnce(new Error("Cache unavailable"));
	await expect(invalidateMergedArticleLinks(pr())).rejects.toThrow(
		"Cache unavailable",
	);
	expect(deps.sync).not.toHaveBeenCalled();
});
