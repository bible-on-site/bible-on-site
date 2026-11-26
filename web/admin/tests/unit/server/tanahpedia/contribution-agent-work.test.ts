import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalJson } from "~/lib/canonical-json";
import * as toolArguments from "~/lib/tanahpedia/contribution-agent-tool-arguments";
import {
	CONTRIBUTION_AGENT_TOOL_ERRORS,
	ContributionAgentToolInputError,
} from "~/lib/tanahpedia/contribution-agent-tool-errors";
import type { RegisteredContributionAgent } from "~/lib/tanahpedia/contribution-agents";
import { CONTRIBUTION_API_VERSION } from "~/lib/tanahpedia/contribution-api";
import type { ArticleLiteralGrounding } from "~/lib/tanahpedia/contribution-article-grounding";
import type { Contribution } from "~/lib/tanahpedia/contributions";
import { buildContributionAgentBundle } from "~/server/tanahpedia/contribution-agent-bundle.server";

const mocks = vi.hoisted(() => ({
	item: null as Contribution | null,
	agent: null as RegisteredContributionAgent | null,
	query: vi.fn(),
	initial: vi.fn(),
	tool: vi.fn(),
	revise: vi.fn(),
	create: vi.fn(),
	aws: vi.fn(),
	queue: vi.fn(),
	read: vi.fn(),
	assigned: vi.fn(),
	lockContext: vi.fn(),
	touch: vi.fn(),
	article: vi.fn(),
	perek: vi.fn(),
}));
vi.mock("~/server/tanahpedia/contribution-perek-reads.server", () => ({
	readAgentPerek: mocks.perek,
}));
vi.mock("~/server/tanahpedia/contribution-article-links.server", () => ({
	readArticleLinkContext: mocks.article,
}));
vi.mock("~/server/db", () => ({ txQuery: mocks.query }));
vi.mock("~/server/tanahpedia/contribution-store.server", () => ({
	withContributions: async (fn: (conn: object) => Promise<unknown>) => fn({}),
	readContribution: mocks.read,
	saveContribution: async (_conn: object, item: Contribution) => {
		item.version++;
		mocks.item = structuredClone(item);
		return item;
	},
}));
vi.mock("~/server/tanahpedia/contribution-agent-registry.server", () => ({
	getAssignedContributionAgent: mocks.assigned,
	getRegisteredContributionAgent: async () => structuredClone(mocks.agent),
	readContributionAgentBundle: async () => structuredClone(mocks.agent?.bundle),
	touchContributionAgent: mocks.touch,
}));
vi.mock("~/server/tanahpedia/contribution-agent-context.server", () => ({
	readContributionAgentInitialContext: mocks.initial,
	readContributionAgentTool: mocks.tool,
	lockContributionAgentContext: mocks.lockContext,
	mergeAgentCatalogues: (
		...catalogues: {
			entities: unknown[];
			targets: unknown[];
			references: Record<string, unknown[]>;
			articleGroundings?: ArticleLiteralGrounding[];
		}[]
	) => ({
		...catalogues[0],
		...(catalogues.some((catalogue) => catalogue.articleGroundings?.length)
			? {
					articleGroundings: catalogues.flatMap(
						(catalogue) => catalogue.articleGroundings ?? [],
					),
				}
			: {}),
		entities: catalogues.flatMap((catalogue) => catalogue.entities),
		targets: catalogues.flatMap((catalogue) => catalogue.targets),
		references: Object.fromEntries(
			[
				...new Set(
					catalogues.flatMap((catalogue) => Object.keys(catalogue.references)),
				),
			].map((family) => [
				family,
				catalogues.flatMap((catalogue) => catalogue.references[family] ?? []),
			]),
		),
	}),
}));
vi.mock("~/server/tanahpedia/contribution-service.server", () => ({
	addEvent: (
		item: Contribution,
		actor: Contribution["author"],
		kind: "agent_response",
		body: string,
	) =>
		item.events.push({
			id: "response",
			actor,
			kind,
			body,
			at: "now",
			revision: item.revision,
		}),
	applyContributionAgentRevision: mocks.revise,
	queueAssignedContributionAgent: mocks.queue,
	assertVersion: vi.fn(),
	createContribution: vi.fn(),
}));
vi.mock("~/server/tanahpedia/contribution-changes.server", () => ({
	contributionCatalogue: vi.fn(),
}));
vi.mock(
	"~/server/tanahpedia/contribution-llm.server",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("~/server/tanahpedia/contribution-llm.server")
		>()),
		createGeneratedContributionPrs: mocks.create,
		awsGenerate: mocks.aws,
	}),
);

import {
	claimContributionAgentWork,
	claimContributionGeneration,
	completeContributionAgentWork,
	failContributionGeneration,
	getContributionWorkerBundle,
	readContributionWorkerContext,
	runAwsContributionAgentTask,
} from "~/server/tanahpedia/contribution-worker.server";

const id = "00000000-0000-4000-8000-000000000010",
	jobId = "00000000-0000-4000-8000-000000000011",
	commentId = "00000000-0000-4000-8000-000000000012";
const human = {
	id: "editor",
	name: "Editor",
	kind: "human" as const,
	isDoradsoft: false,
};
const empty = {
	people: [],
	places: [],
	entities: [],
	targets: [],
	references: {},
};
function current() {
	if (!mocks.item) throw new Error("Missing fixture item");
	return mocks.item;
}
function agent() {
	if (!mocks.agent) throw new Error("Missing fixture agent");
	return mocks.agent;
}
function job() {
	const generation = current().generation;
	if (!generation) throw new Error("Missing fixture generation");
	return generation;
}
const output = (outcome = "unchanged", extra = {}) =>
	JSON.stringify({
		outcome,
		summary: "תגובה",
		responses: [{ commentId, status: "addressed", body: "טופל" }],
		...extra,
	});
beforeEach(() => {
	vi.resetAllMocks();
	const bundle = buildContributionAgentBundle();
	mocks.agent = {
		id: jobId,
		version: 1,
		name: "Local editor",
		provider: "local_llm",
		model: "configured-model",
		enabled: true,
		installedVersion: bundle.version,
		bundleHash: bundle.hash,
		bundle,
		createdAt: "then",
		updatedAt: "then",
		lastSeenAt: null,
		runtimeVersion: null,
	};
	mocks.item = {
		id,
		number: 10,
		kind: "pr",
		state: "open",
		title: "Existing PR",
		description: "Keep body",
		author: human,
		assignee: { kind: "local_llm", agentId: jobId },
		evidence: [
			{ citation: "בראשית א א", quote: "source", url: null, note: "" },
		],
		changes: [
			{
				kind: "metadata",
				targetId: id,
				before: { displayName: "old" },
				after: { displayName: "new" },
				labels: {},
			},
		],
		issueId: null,
		revision: 4,
		version: 6,
		events: [
			{
				id: commentId,
				kind: "comment",
				actor: human,
				body: "Please fix",
				at: "now",
				revision: 4,
			},
		],
		createdAt: "then",
		updatedAt: "now",
		closeIssue: false,
		provenance: null,
		generation: {
			id: jobId,
			status: "queued",
			requestedAt: "now",
			requestedBy: "editor",
			attempts: 0,
			apiVersion: CONTRIBUTION_API_VERSION,
			worker: null,
			model: null,
			leaseHash: null,
			leaseExpiresAt: null,
			claimedVersion: null,
			contextHash: null,
			outputHash: null,
			prIds: [],
			error: null,
			task: "pr_resolution",
			provider: "local_llm",
			agentId: jobId,
			bundleVersion: bundle.version,
			bundleHash: bundle.hash,
		},
	};
	mocks.query.mockResolvedValue([{ id }]);
	mocks.read.mockImplementation(async () => structuredClone(mocks.item));
	mocks.assigned.mockImplementation(async () => structuredClone(mocks.agent));
	mocks.queue.mockImplementation(async (_conn, item) => {
		Object.assign(item.generation, {
			id: commentId,
			status: agent().enabled && agent().model ? "queued" : "needs_input",
			attempts: 0,
			agentVersion: agent().version,
			bundleHash: agent().bundleHash,
			leaseHash: null,
			leaseExpiresAt: null,
		});
		return true;
	});
	mocks.initial.mockResolvedValue({
		data: { item: { id }, discussion: { total: 21 } },
		catalogue: empty,
		hash: "fresh-initial-context",
		relatedIds: [],
	});
	mocks.tool.mockResolvedValue({
		data: {
			items: [{ id, name: "current record" }],
			total: 1,
			nextCursor: null,
		},
		catalogue: { ...empty, entities: [{ id, name: "current record" }] },
	});
	mocks.revise.mockImplementation(async (_conn, item, draft, actor) => {
		if (draft.title === item.title) return false;
		item.title = draft.title ?? item.title;
		item.revision++;
		item.revisionAuthor = actor;
		return true;
	});
});
async function claim() {
	const value = await claimContributionGeneration({
		workerId: "workstation",
		protocolVersion: 2,
		supportedTasks: ["issue_implementation", "pr_resolution"],
	});
	if (!value) throw new Error("Missing fixture claim");
	return {
		issueId: id,
		jobId: value.id,
		token: value.token,
		version: value.version,
		apiVersion: value.apiVersion,
		protocolVersion: 2,
		model: "forged-owner-name",
	};
}

describe("assignment-driven leased contribution work", () => {
	it("adds receipt-backed article evidence while revising the same PR and retaining its other fields", async () => {
		const input = await claim();
		const quote = "בראשית א כו";
		const chapter = {
			seferName: "בראשית",
			additionalLetter: null,
			perekInContext: 1,
			pasukCount: 31,
		};
		mocks.perek.mockResolvedValue({ id: 1, coordinates: chapter });
		const change = {
			kind: "article_links" as const,
			targetId: "27",
			before: null,
			after: {
				commands: [
					{
						relationshipKey: "coveringSources" as const,
						action: "add" as const,
						target: { pasukCoordinates: [{ perekId: 1, pasuk: 26 }] },
					},
				],
			},
			labels: {},
		};
		current().changes = [change];
		const original = structuredClone(current());
		mocks.article.mockResolvedValue({
			plainText: quote,
			state: { contentHash: "a".repeat(32), sourceHash: "b".repeat(64) },
		});
		mocks.tool.mockResolvedValue({
			data: {
				id: "27",
				cursor: 0,
				total: quote.length,
				text: quote,
				nextCursor: null,
			},
			catalogue: {
				...empty,
				articleGroundings: [
					{
						articleId: "27",
						sourceHash: "b".repeat(64),
						coordinates: [{ perekId: 1, pasuk: 26 }],
						chapters: [
							{
								id: 1,
								fingerprint: createHash("sha256")
									.update(canonicalJson(chapter))
									.digest("hex"),
							},
						],
						citations: [
							{
								perekId: 1,
								pasuk: 26,
								pasukTo: 26,
								label: quote,
								quote,
								spanStart: 0,
								spanEnd: quote.length,
							},
						],
					},
				],
			},
		});
		const read = await readContributionWorkerContext({
			...input,
			name: "article_text",
			arguments: { id: "27" },
		});
		if ("error" in read) throw new Error("Expected a source receipt");
		mocks.revise.mockImplementationOnce(async (_conn, item, draft) => {
			item.evidence = draft.evidence;
			item.revision++;
			return true;
		});
		await completeContributionAgentWork({
			...input,
			receipts: [read.receipt],
			content: output("revised", { draft: { evidenceIndexes: [0] } }),
		});
		expect(current()).toMatchObject({
			id: original.id,
			title: original.title,
			description: original.description,
			changes: original.changes,
			revision: original.revision + 1,
		});
		expect(current().evidence).toHaveLength(2);
		expect(current().evidence[0]).toEqual(original.evidence[0]);
		expect(current().evidence[1]).toMatchObject({
			citation: quote,
			quote,
			articleSource: { articleId: "27", spanStart: 0, spanEnd: quote.length },
		});
		expect(mocks.create).not.toHaveBeenCalled();
		expect(job().result).toMatchObject({
			changed: true,
			pendingCommentIds: [],
		});
	});
	it("keeps unexpected argument-validator faults fatal without returning model feedback", async () => {
		const input = await claim();
		const failure = new TypeError("Internal validation failure");
		const spy = vi
			.spyOn(toolArguments, "validateContributionAgentToolArguments")
			.mockImplementation(() => {
				throw failure;
			});
		try {
			await expect(
				readContributionWorkerContext({
					...input,
					name: "record",
					arguments: { kind: "entity", id },
				}),
			).rejects.toBe(failure);
			expect(mocks.tool).not.toHaveBeenCalled();
		} finally {
			spy.mockRestore();
		}
	});
	it.each(["invalidAction", "untypedFailure"])(
		"records a failed AWS pass without writes for %s",
		async (failure) => {
			agent().provider = "aws_llm";
			current().assignee = { kind: "aws_llm", agentId: jobId };
			job().provider = "aws_llm";
			if (failure === "invalidAction")
				mocks.aws.mockResolvedValue({
					content: JSON.stringify({ action: "approve" }),
					model: "configured-model",
				});
			else mocks.aws.mockRejectedValue("private untyped provider failure");
			expect(await runAwsContributionAgentTask()).toMatchObject({
				status: "failed",
			});
			expect(job().status).toBe("failed");
			expect(job().error).toBe(
				failure === "invalidAction"
					? "Invalid agent action"
					: "AWS agent failed",
			);
			expect(mocks.revise).not.toHaveBeenCalled();
			expect(mocks.create).not.toHaveBeenCalled();
		},
	);
	it("locks the complete contribution graph before final item, agent and domain reads for a PR revision", async () => {
		const input = await claim(),
			order: string[] = [];
		mocks.lockContext.mockImplementation(async () => {
			order.push("graph");
		});
		mocks.read.mockImplementation(async () => {
			order.push("item");
			return structuredClone(mocks.item);
		});
		mocks.assigned.mockImplementation(async (_conn, _assignee, lock) => {
			order.push(lock ? "locked-agent" : "agent");
			return structuredClone(mocks.agent);
		});
		mocks.initial.mockImplementation(async () => {
			order.push("domain");
			return {
				data: {},
				catalogue: empty,
				hash: "fresh-initial-context",
				relatedIds: [],
			};
		});
		await completeContributionAgentWork({
			...input,
			content: output("revised", { draft: { title: "Reviewed correction" } }),
		});
		const final = order.slice(order.indexOf("graph"));
		expect(final[0]).toBe("graph");
		expect(final.indexOf("item")).toBeGreaterThan(0);
		expect(final.indexOf("locked-agent")).toBeGreaterThan(
			final.indexOf("item"),
		);
		expect(final.indexOf("domain")).toBeGreaterThan(
			final.indexOf("locked-agent"),
		);
		expect(mocks.initial.mock.calls.at(-1)?.[2]).toBe(true);
		expect(mocks.lockContext).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ id, kind: "pr" }),
			[],
		);
	});
	it("locks and records the accepted agent configuration before reading domain context", async () => {
		await claim();
		const locked = mocks.assigned.mock.calls.findIndex(
			(call) => call[2] === true,
		);
		expect(locked).toBeGreaterThanOrEqual(0);
		expect(mocks.touch.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.assigned.mock.invocationCallOrder[locked],
		);
		expect(mocks.assigned.mock.invocationCallOrder[locked]).toBeLessThan(
			mocks.initial.mock.invocationCallOrder[0],
		);
	});
	it.each(["version", "bundle", "disabled"])(
		"does not spend a lease when %s races the final claim configuration lock",
		async (changed) => {
			const prior = structuredClone(agent()),
				locked = structuredClone(agent());
			if (changed === "version") locked.version++;
			if (changed === "bundle") locked.bundleHash = "b".repeat(64);
			if (changed === "disabled") locked.enabled = false;
			mocks.assigned.mockResolvedValueOnce(prior).mockResolvedValueOnce(locked);
			const original = structuredClone(current());
			expect(
				await claimContributionGeneration({
					workerId: "race",
					protocolVersion: 2,
					supportedTasks: ["pr_resolution"],
				}),
			).toBeNull();
			expect(current()).toEqual(original);
			expect(mocks.initial).not.toHaveBeenCalled();
		},
	);
	it("persists valid clarification without a draft while preserving the approved proposal", async () => {
		current().events.push({
			id: "approved",
			kind: "approved",
			actor: { ...human, isDoradsoft: true },
			body: "approved",
			at: "now",
			revision: current().revision,
		});
		const input = await claim(),
			original = structuredClone(current());
		const content = JSON.stringify({
			outcome: "clarification",
			summary: "Please confirm the source identity",
			responses: [
				{
					commentId,
					status: "needs_input",
					body: "Which supplied source is intended?",
				},
			],
		});
		await completeContributionAgentWork({ ...input, content });
		expect(current().revision).toBe(original.revision);
		expect(current().changes).toEqual(original.changes);
		expect(current().events.find((event) => event.id === "approved")).toEqual(
			original.events.find((event) => event.id === "approved"),
		);
		expect(job()).toMatchObject({
			status: "needs_input",
			result: {
				outcome: "clarification",
				changed: false,
				pendingCommentIds: [commentId],
			},
		});
		expect(mocks.revise).not.toHaveBeenCalled();
		expect(mocks.create).not.toHaveBeenCalled();
	});
	it.each(["bundle", "api", "protocol"])(
		"an older server cannot read, complete or fail a running incompatible %s lease",
		async (incompatible) => {
			const input = await claim();
			if (incompatible === "bundle") {
				job().bundleHash = "b".repeat(64);
				agent().bundleHash = "b".repeat(64);
			}
			if (incompatible === "api") job().apiVersion++;
			if (incompatible === "protocol")
				Object.assign(agent().bundle, { protocolVersion: 3 });
			const original = structuredClone(current());
			await expect(
				readContributionWorkerContext({
					...input,
					name: "discussion",
					arguments: { source: "item" },
				}),
			).rejects.toThrow(/bundle|API/);
			await expect(
				completeContributionAgentWork({ ...input, content: output() }),
			).rejects.toThrow(/bundle|API/);
			expect(
				await failContributionGeneration({
					...input,
					error: "Older worker rejected the response",
				}),
			).toBe(false);
			expect(current()).toEqual(original);
			expect(mocks.tool).not.toHaveBeenCalled();
			expect(mocks.revise).not.toHaveBeenCalled();
		},
	);
	it("does not fail an otherwise-owned lease during a current configuration race", async () => {
		const input = await claim();
		agent().version++;
		const original = structuredClone(current());
		await expect(
			completeContributionAgentWork({ ...input, content: output() }),
		).rejects.toThrow("configuration");
		expect(
			await failContributionGeneration({
				...input,
				error: "Configuration changed",
			}),
		).toBe(false);
		expect(current()).toEqual(original);
	});
	it("returns an identical completed receipt across release versions without executing the newer declarations", async () => {
		const input = await claim(),
			request = { ...input, content: output() };
		expect(await completeContributionAgentWork(request)).toEqual({ prIds: [] });
		agent().installedVersion = "tanahpedia-agents-v4";
		agent().bundleHash = "b".repeat(64);
		job().bundleHash = agent().bundleHash;
		job().bundleVersion = agent().installedVersion;
		job().apiVersion++;
		mocks.initial.mockClear();
		expect(await completeContributionAgentWork(request)).toEqual({ prIds: [] });
		expect(mocks.initial).not.toHaveBeenCalled();
		expect(
			current().events.filter((event) => event.kind === "agent_response"),
		).toHaveLength(1);
	});
	it.each([
		"bundle",
		"api",
		"protocol",
		"newer-release",
		"older-release",
		"job-api",
		"job-bundle",
	])(
		"leaves incompatible %s jobs untouched before normalization or attempt exhaustion",
		async (incompatible) => {
			job().attempts = 3;
			if (incompatible === "bundle") agent().bundleHash = "b".repeat(64);
			if (incompatible === "api") agent().bundle.apiVersion++;
			if (incompatible === "protocol")
				Object.assign(agent().bundle, { protocolVersion: 3 });
			if (incompatible === "newer-release")
				agent().installedVersion = agent().installedVersion.replace(
					/\d+$/,
					(version) => String(Number(version) + 1),
				);
			if (incompatible === "older-release")
				agent().installedVersion = "tanahpedia-agents-v0";
			if (incompatible === "job-api") job().apiVersion++;
			if (incompatible === "job-bundle") job().bundleHash = "b".repeat(64);
			const original = structuredClone(current());
			mocks.query.mockResolvedValueOnce([{ id }]).mockResolvedValueOnce([]);
			expect(
				await claimContributionGeneration({
					workerId: "old-server",
					protocolVersion: 2,
					supportedTasks: ["pr_resolution"],
				}),
			).toBeNull();
			expect(current()).toEqual(original);
			expect(mocks.queue).not.toHaveBeenCalled();
			expect(mocks.initial).not.toHaveBeenCalled();
			expect(mocks.query.mock.calls[1][1]).toContain("AND c.id NOT IN (?)");
			expect(mocks.query.mock.calls[1][2]).toContain(id);
		},
	);
	it("skips an incompatible task without starving the next locally implemented assignment", async () => {
		const incompatible = structuredClone(current()),
			next = structuredClone(current());
		next.id = commentId;
		mocks.read.mockResolvedValueOnce(incompatible).mockResolvedValueOnce(next);
		mocks.assigned
			.mockResolvedValueOnce({
				...agent(),
				installedVersion: agent().installedVersion.replace(/\d+$/, (version) =>
					String(Number(version) + 1),
				),
			})
			.mockResolvedValueOnce(agent());
		mocks.query
			.mockResolvedValueOnce([{ id }])
			.mockResolvedValueOnce([{ id: commentId }]);
		const value = await claimContributionGeneration({
			workerId: "one",
			protocolVersion: 2,
			supportedTasks: ["pr_resolution"],
		});
		expect(value?.issueId).toBe(commentId);
		expect(incompatible.generation).toMatchObject({
			attempts: 0,
			status: "queued",
			leaseHash: null,
		});
		expect(mocks.queue).not.toHaveBeenCalled();
		expect(mocks.initial).toHaveBeenCalledTimes(1);
	});
	it("receipts an already-implemented issue without duplicate PR creation or a fake clarification", async () => {
		current().kind = "issue";
		job().task = "issue_implementation";
		mocks.initial.mockResolvedValue({
			data: {
				item: { id },
				related: {
					total: 1,
					items: [{ id: commentId, state: "open" }],
					nextCursor: null,
				},
			},
			catalogue: empty,
			hash: "prior-work",
			relatedIds: [commentId],
		});
		const input = await claim(),
			request = { ...input, content: output("unchanged") };
		expect(await completeContributionAgentWork(request)).toEqual({ prIds: [] });
		expect(await completeContributionAgentWork(request)).toEqual({ prIds: [] });
		expect(job()).toMatchObject({
			status: "completed",
			result: { outcome: "unchanged", changed: false },
		});
		expect(
			current().events.filter((event) => event.kind === "agent_response"),
		).toHaveLength(1);
		expect(mocks.create).not.toHaveBeenCalled();
	});
	it("leaves idle queues untouched and reports exhausted leases without making another inference attempt", async () => {
		mocks.query.mockResolvedValueOnce([]);
		expect(
			await claimContributionGeneration({
				workerId: "one",
				protocolVersion: 2,
				supportedTasks: ["pr_resolution"],
			}),
		).toBeNull();
		job().attempts = 3;
		mocks.query.mockResolvedValueOnce([{ id }]).mockResolvedValueOnce([]);
		expect(
			await claimContributionGeneration({
				workerId: "one",
				protocolVersion: 2,
				supportedTasks: ["pr_resolution"],
			}),
		).toBeNull();
		expect(job().status).toBe("failed");
		expect(mocks.initial).not.toHaveBeenCalled();
	});
	it("settles an ineligible agent instead of letting it starve later queued work", async () => {
		agent().enabled = false;
		mocks.query.mockResolvedValueOnce([{ id }]).mockResolvedValueOnce([]);
		expect(
			await claimContributionGeneration({
				workerId: "one",
				protocolVersion: 2,
				supportedTasks: ["pr_resolution"],
			}),
		).toBeNull();
		expect(job()).toMatchObject({ status: "needs_input", attempts: 0 });
		expect(mocks.queue).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.objectContaining({ kind: "system" }),
			"assignment",
			[],
		);
		expect(mocks.initial).not.toHaveBeenCalled();
	});
	it("normalizes a queued configuration race before leasing the refreshed request", async () => {
		job().agentVersion = 1;
		job().attempts = 3;
		job().triggerEventIds = [commentId];
		agent().version = 2;
		const input = await claim();
		expect(input.jobId).toBe(commentId);
		expect(job()).toMatchObject({
			agentVersion: 2,
			attempts: 1,
			status: "running",
			triggerEventIds: [commentId],
		});
		expect(mocks.queue).toHaveBeenCalledTimes(1);
		expect(mocks.initial).toHaveBeenCalledTimes(1);
	});
	it("continues to the next eligible item after atomically pausing a disabled assignment", async () => {
		const paused = structuredClone(current()),
			next = structuredClone(current());
		next.id = commentId;
		mocks.read.mockResolvedValueOnce(paused).mockResolvedValueOnce(next);
		mocks.assigned
			.mockResolvedValueOnce({ ...agent(), enabled: false })
			.mockResolvedValueOnce(agent());
		mocks.queue.mockImplementationOnce(async (_conn, item) => {
			item.generation.status = "needs_input";
			return true;
		});
		mocks.query
			.mockResolvedValueOnce([{ id }])
			.mockResolvedValueOnce([{ id: commentId }]);
		const claimed = await claimContributionGeneration({
			workerId: "one",
			protocolVersion: 2,
			supportedTasks: ["pr_resolution"],
		});
		expect(claimed?.issueId).toBe(commentId);
		expect(paused.generation?.status).toBe("needs_input");
		expect(paused.generation?.attempts).toBe(0);
		expect(mocks.query).toHaveBeenCalledTimes(2);
	});
	it("creates issue implementation PRs under the registry identity and atomic completion hook", async () => {
		current().kind = "issue";
		job().task = "issue_implementation";
		mocks.create.mockImplementation(async (_context, _result, hooks) => {
			await hooks.beforeCreate({});
			const item = structuredClone(current()),
				prs = [{ id }];
			await hooks.afterCreate({}, item, prs);
			item.version++;
			mocks.item = item;
			return prs;
		});
		const input = await claim();
		const result = await completeContributionAgentWork({
			...input,
			content: output("implemented", {
				pullRequests: [
					{
						title: "הצעה",
						description: "מקור",
						evidenceIndexes: [0],
						changes: [
							{
								kind: "entry",
								after: {
									title: "חדש",
									uniqueName: "חדש",
									entityType: "PERSON",
									displayName: "חדש",
								},
							},
						],
					},
				],
			}),
		});
		expect(result.prIds).toEqual([id]);
		expect(mocks.lockContext).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ id, kind: "issue" }),
			[],
		);
		expect(mocks.lockContext.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.assigned.mock.invocationCallOrder[
				mocks.assigned.mock.calls.length - 1
			],
		);
		expect(mocks.assigned.mock.calls.at(-1)?.[2]).toBe(true);
		expect(mocks.initial.mock.calls.at(-1)?.[2]).toBe(true);
		expect(
			mocks.assigned.mock.invocationCallOrder[
				mocks.assigned.mock.calls.length - 1
			],
		).toBeLessThan(
			mocks.initial.mock.invocationCallOrder[
				mocks.initial.mock.calls.length - 1
			],
		);
		expect(mocks.create.mock.calls[0][2]).toMatchObject({
			actor: { id: `agent:${jobId}`, isDoradsoft: false },
			promptVersion: agent().installedVersion,
		});
		expect(job()).toMatchObject({
			status: "completed",
			prIds: [id],
			result: { outcome: "implemented", changed: true },
		});
	});
	it("AWS idle and failed runs stop without blindly retrying the inference", async () => {
		mocks.query.mockResolvedValueOnce([]);
		expect(await runAwsContributionAgentTask()).toEqual({ status: "idle" });
		agent().provider = "aws_llm";
		current().assignee = { kind: "aws_llm", agentId: jobId };
		job().provider = "aws_llm";
		mocks.aws.mockRejectedValueOnce(new Error("inference failed"));
		expect(await runAwsContributionAgentTask()).toMatchObject({
			status: "failed",
			error: "inference failed",
		});
		expect(mocks.aws).toHaveBeenCalledTimes(1);
		expect(job().status).toBe("failed");
	});
	it.each(["missingTask", "savedBundle", "installedBundle", "disabled"])(
		"rejects a %s lease change before tool execution or context disclosure",
		async (change) => {
			const input = await claim();
			if (change === "missingTask") delete job().task;
			if (change === "savedBundle") job().bundleHash = "f".repeat(64);
			if (change === "installedBundle") agent().bundleHash = "f".repeat(64);
			if (change === "disabled") agent().enabled = false;
			const before = structuredClone(current());
			mocks.initial.mockClear();
			await expect(
				readContributionWorkerContext({
					...input,
					name: "record",
					arguments: { kind: "entity", id },
				}),
			).rejects.toThrow(
				/agent task changed|does not implement|configuration or bundle changed/,
			);
			expect(mocks.initial).not.toHaveBeenCalled();
			expect(mocks.tool).not.toHaveBeenCalled();
			expect(current()).toEqual(before);
		},
	);
	it.each(["object", "oversize"])(
		"rejects an invalid %s receipt collection before replaying any tool",
		async (shape) => {
			const receipts =
				shape === "object" ? {} : Array.from({ length: 1001 }, () => ({}));
			const input = await claim();
			const before = structuredClone(current());
			await expect(
				readContributionWorkerContext({
					...input,
					name: "record",
					arguments: { kind: "entity", id },
					receipts,
				}),
			).rejects.toThrow("Invalid context receipts");
			expect(mocks.tool).not.toHaveBeenCalled();
			expect(current()).toEqual(before);
		},
	);
	it("rejects an undeclared prior receipt before evaluating its arguments", async () => {
		const input = await claim();
		await expect(
			readContributionWorkerContext({
				...input,
				name: "record",
				arguments: { kind: "entity", id },
				receipts: [
					{ name: "execute_sql", arguments: {}, hash: "a".repeat(64) },
				],
			}),
		).rejects.toThrow("Unsupported agent tool");
		expect(mocks.tool).not.toHaveBeenCalled();
	});
	it.each(["g".repeat(64), "a".repeat(63)])(
		"rejects invalid bundle hashes before registry access: %s",
		async (hash) => {
			await expect(getContributionWorkerBundle({ hash })).rejects.toThrow(
				"Invalid bundle hash",
			);
		},
	);
	it("leases a same-PR resolution using registered task/provider/bundle metadata", async () => {
		const input = await claim();
		expect(input.version).toBe(7);
		expect(current().generation).toMatchObject({
			task: "pr_resolution",
			provider: "local_llm",
			agentId: jobId,
			agentVersion: 1,
			attempts: 1,
			bundleHash: agent().bundleHash,
		});
		expect(mocks.query.mock.calls[0][2][0]).toBe("local_llm");
		expect(current().generation?.leaseHash).not.toBe(input.token);
	});
	it("returns only fixed argument feedback after a valid lease without reading or writing a target", async () => {
		const input = await claim(),
			before = structuredClone(current());
		expect(
			await readContributionWorkerContext({
				...input,
				name: "record",
				arguments: { kind: "target:article_links", id },
			}),
		).toEqual({
			error: {
				type: "invalid_tool_arguments",
				code: "invalid_article_id",
				message: CONTRIBUTION_AGENT_TOOL_ERRORS.invalid_article_id,
			},
		});
		expect(mocks.tool).not.toHaveBeenCalled();
		expect(current()).toEqual(before);
		expect(mocks.create).not.toHaveBeenCalled();
		expect(mocks.revise).not.toHaveBeenCalled();
	});
	it("does not turn lease, stale context or prior-receipt rejection into recoverable input feedback", async () => {
		const input = await claim(),
			request = {
				...input,
				name: "record",
				arguments: { kind: "target:article_links", id },
			};
		await expect(
			readContributionWorkerContext({ ...request, token: "a".repeat(64) }),
		).rejects.toThrow("owns");
		mocks.initial.mockResolvedValueOnce({
			data: {},
			catalogue: empty,
			hash: "stale",
		});
		await expect(readContributionWorkerContext(request)).rejects.toThrow(
			"context changed",
		);
		mocks.tool.mockRejectedValueOnce(
			new ContributionAgentToolInputError("invalid_arguments"),
		);
		await expect(
			readContributionWorkerContext({
				...request,
				receipts: [
					{
						name: "record",
						arguments: { kind: "entity", id },
						hash: "a".repeat(64),
					},
				],
			}),
		).rejects.toBeInstanceOf(ContributionAgentToolInputError);
		expect(current().generation?.status).toBe("running");
	});
	it.each([
		new Error("Proposal is not linked to this issue"),
		Object.assign(new Error("private SQL"), { code: "ER_LOCK_NOWAIT" }),
		new Error("Missing contribution reference lock contract"),
	])("leaves read execution and storage errors fatal", async (failure) => {
		const input = await claim();
		mocks.tool.mockRejectedValueOnce(failure);
		await expect(
			readContributionWorkerContext({
				...input,
				name: "record",
				arguments: { kind: "entity", id },
			}),
		).rejects.toBe(failure);
		expect(mocks.revise).not.toHaveBeenCalled();
	});
	it("retains a receipt-bearing null result for a valid missing record", async () => {
		const input = await claim();
		mocks.tool.mockResolvedValueOnce({
			data: { record: null },
			catalogue: empty,
		});
		const read = await readContributionWorkerContext({
			...input,
			name: "record",
			arguments: { kind: "entity", id },
		});
		expect(read).toMatchObject({
			data: { record: null },
			receipt: { hash: expect.any(String) },
			schema: expect.any(Object),
		});
		expect(read).not.toHaveProperty("error");
	});
	it("AWS receives the same rejected-call feedback without a new receipt or schema authority", async () => {
		agent().provider = "aws_llm";
		current().assignee = { kind: "aws_llm", agentId: jobId };
		job().provider = "aws_llm";
		mocks.aws
			.mockResolvedValueOnce({
				content: JSON.stringify({
					action: "tool",
					name: "record",
					arguments: { kind: "target:article_links", id },
				}),
				model: "configured-model",
			})
			.mockResolvedValueOnce({
				content: JSON.stringify({
					action: "complete",
					result: JSON.parse(output()),
				}),
				model: "configured-model",
			});
		expect(await runAwsContributionAgentTask()).toMatchObject({
			status: "completed",
		});
		expect(mocks.tool).not.toHaveBeenCalled();
		expect(mocks.aws.mock.calls[1][2]).toEqual(mocks.aws.mock.calls[0][2]);
		expect(JSON.parse(mocks.aws.mock.calls[1][1]).turns).toEqual([
			{
				request: {
					action: "tool",
					name: "record",
					arguments: { kind: "target:article_links", id },
				},
				response: {
					error: {
						type: "invalid_tool_arguments",
						code: "invalid_article_id",
						message: CONTRIBUTION_AGENT_TOOL_ERRORS.invalid_article_id,
					},
				},
			},
		]);
		expect(mocks.aws.mock.calls[1][3].signal).toBe(
			mocks.aws.mock.calls[0][3].signal,
		);
		expect(mocks.revise).not.toHaveBeenCalled();
	});
	it("validates dynamic read receipts and expands permitted final IDs", async () => {
		const input = await claim();
		const read = await readContributionWorkerContext({
			...input,
			name: "record",
			arguments: { kind: "entity", id },
		});
		if ("error" in read) throw new Error("Expected a successful read");
		expect(read.receipt.hash).toMatch(/^[a-f0-9]{64}$/);
		expect(JSON.stringify(read.schema)).toContain(id);
		await completeContributionAgentWork({
			...input,
			receipts: [read.receipt],
			content: output("revised", {
				draft: {
					changes: [
						{ kind: "metadata", targetId: id, after: { displayName: "new" } },
					],
				},
			}),
		});
		expect(mocks.revise).toHaveBeenCalledTimes(1);
		expect(mocks.create).not.toHaveBeenCalled();
		const lockedReads = mocks.tool.mock.calls
			.map((call, index) => ({ call, index }))
			.filter(({ call }) => call[4] === true);
		expect(lockedReads).toHaveLength(1);
		expect(lockedReads[0].call.slice(2)).toEqual([
			"record",
			{ kind: "entity", id },
			true,
		]);
		expect(mocks.lockContext.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.tool.mock.invocationCallOrder[lockedReads[0].index],
		);
	});
	it("uses current API article read receipts to resolve the same PR with known nested identities", async () => {
		const input = await claim();
		expect(input.apiVersion).toBe(7);
		expect(agent().installedVersion).toBe("tanahpedia-agents-v15");
		mocks.tool.mockResolvedValue({
			data: {
				kind: "target:article_links",
				id: "27",
				sourceHash: "a".repeat(64),
			},
			catalogue: {
				...empty,
				targets: [{ kind: "article_links", id: "27" }],
				references: { perek: [{ id: 99, name: "פרק" }] },
			},
		});
		const read = await readContributionWorkerContext({
			...input,
			name: "record",
			arguments: { kind: "target:article_links", id: "27" },
		});
		expect(JSON.stringify(read.schema)).toContain('"const":"article_links"');
		const changes = [
			{
				kind: "article_links",
				targetId: "27",
				after: {
					commands: [
						{
							relationshipKey: "primaryPerek",
							action: "replace",
							target: { perekId: 99 },
						},
					],
				},
			},
		];
		await completeContributionAgentWork({
			...input,
			receipts: [read.receipt],
			content: output("revised", { draft: { changes } }),
		});
		expect(mocks.revise).toHaveBeenCalledOnce();
		expect(mocks.revise.mock.calls[0][2]).toMatchObject({ changes });
		expect(mocks.create).not.toHaveBeenCalled();
	});

	it("rejects an article source hash change outside the read text page before authoring", async () => {
		const input = await claim();
		const data = {
			id: "27",
			text: "unchanged first page",
			total: 40000,
			nextCursor: 4000,
			sourceHash: "a".repeat(64),
		};
		mocks.tool.mockResolvedValue({ data, catalogue: empty });
		const read = await readContributionWorkerContext({
			...input,
			name: "article_text",
			arguments: { id: "27", cursor: 0 },
		});
		mocks.tool.mockResolvedValue({
			data: { ...data, sourceHash: "b".repeat(64) },
			catalogue: empty,
		});
		await expect(
			completeContributionAgentWork({
				...input,
				receipts: [read.receipt],
				content: output("revised", { draft: { title: "Must not apply" } }),
			}),
		).rejects.toThrow("tool-read record or discussion changed");
		expect(mocks.revise).not.toHaveBeenCalled();
		expect(mocks.create).not.toHaveBeenCalled();
	});
	it("writes one authored same-PR revision and an idempotent immutable response receipt", async () => {
		const input = await claim(),
			originalComment = structuredClone(current().events[0]);
		const body = {
			...input,
			content: output("revised", { draft: { title: "Corrected PR" } }),
		};
		expect(await completeContributionAgentWork(body)).toEqual({ prIds: [] });
		expect(await completeContributionAgentWork(body)).toEqual({ prIds: [] });
		expect(current()).toMatchObject({
			id,
			title: "Corrected PR",
			description: "Keep body",
			revision: 5,
			assignee: { kind: "local_llm" },
			revisionAuthor: {
				id: `agent:${jobId}`,
				name: "Local editor",
				kind: "local_llm",
				isDoradsoft: false,
			},
		});
		expect(current().events[0]).toEqual(originalComment);
		expect(
			current().events.filter((event) => event.kind === "agent_response"),
		).toHaveLength(1);
		expect(current().generation?.result).toMatchObject({
			changed: true,
			addressedCommentIds: [commentId],
			pendingCommentIds: [],
			revision: 5,
		});
		expect(current().generation?.model).toBe("configured-model");
		expect(mocks.revise).toHaveBeenCalledTimes(1);
	});
	it("responds without an authored edit, retaining the exact approved revision", async () => {
		current().events.push({
			id: "approved",
			kind: "approved",
			actor: { ...human, isDoradsoft: true },
			body: "approved",
			at: "now",
			revision: 4,
		});
		const input = await claim();
		await completeContributionAgentWork({ ...input, content: output() });
		expect(current().revision).toBe(4);
		expect(
			current().events.some(
				(event) => event.kind === "approved" && event.revision === 4,
			),
		).toBe(true);
		expect(current().generation?.result?.changed).toBe(false);
		expect(mocks.revise).not.toHaveBeenCalled();
	});
	it("finishes missing-evidence issues as needs_input without creating proposals", async () => {
		current().kind = "issue";
		current().evidence = [];
		current().events = [];
		const input = await claim();
		await completeContributionAgentWork({
			...input,
			content: JSON.stringify({
				outcome: "clarification",
				summary: "נדרש מקור",
				responses: [],
			}),
		});
		expect(current().generation?.status).toBe("needs_input");
		expect(mocks.create).not.toHaveBeenCalled();
	});
	it.each([
		"version",
		"bundle",
		"configuration",
		"context",
		"record",
		"assignment",
		"expiry",
	])("rejects %s drift before an authored edit", async (drift) => {
		const input = await claim();
		const read = await readContributionWorkerContext({
			...input,
			name: "record",
			arguments: { kind: "entity", id },
		});
		if (drift === "version") current().version++;
		if (drift === "bundle") agent().bundleHash = "b".repeat(64);
		if (drift === "configuration") agent().version++;
		if (drift === "context")
			mocks.initial.mockResolvedValue({
				data: {},
				catalogue: empty,
				hash: "changed",
			});
		if (drift === "record")
			mocks.tool.mockResolvedValue({
				data: { changed: true },
				catalogue: empty,
			});
		if (drift === "assignment") current().assignee = { kind: "unassigned" };
		if (drift === "expiry") job().leaseExpiresAt = "2000-01-01T00:00:00Z";
		await expect(
			completeContributionAgentWork({
				...input,
				receipts: [read.receipt],
				content: output("revised", { draft: { title: "Do not write" } }),
			}),
		).rejects.toThrow();
		expect(mocks.revise).not.toHaveBeenCalled();
		expect(current().title).toBe("Existing PR");
	});
	it("does not let a superseded failure overwrite the newly queued human comment pass", async () => {
		const input = await claim();
		job().id = id;
		job().status = "queued";
		await expect(
			completeContributionAgentWork({ ...input, content: output() }),
		).rejects.toThrow();
		expect(current().generation).toMatchObject({
			id,
			status: "queued",
			error: null,
		});
	});
	it("rejects undeclared capabilities and undeclared tools before reading data", async () => {
		await expect(
			claimContributionAgentWork(
				{ workerId: "one", protocolVersion: 2, supportedTasks: ["merge"] },
				"local_llm",
			),
		).rejects.toThrow("protocol");
		const input = await claim();
		await expect(
			readContributionWorkerContext({ ...input, name: "sql", arguments: {} }),
		).rejects.toThrow("Unsupported");
		expect(mocks.tool).not.toHaveBeenCalled();
	});
	it("AWS background work uses one original deadline across tool turns and the identical completion path", async () => {
		agent().provider = "aws_llm";
		current().assignee = { kind: "aws_llm", agentId: jobId };
		job().provider = "aws_llm";
		mocks.aws
			.mockResolvedValueOnce({
				content: JSON.stringify({
					action: "tool",
					name: "discussion",
					arguments: { source: "item", cursor: 20 },
				}),
				model: "configured-model",
			})
			.mockResolvedValueOnce({
				content: JSON.stringify({
					action: "complete",
					result: JSON.parse(output()),
				}),
				model: "configured-model",
			});
		expect(await runAwsContributionAgentTask()).toMatchObject({
			status: "completed",
			contributionId: id,
		});
		expect(mocks.aws.mock.calls[0][3].signal).toBe(
			mocks.aws.mock.calls[1][3].signal,
		);
		expect(mocks.query.mock.calls[0][2][0]).toBe("aws_llm");
		expect(current().events.at(-1)?.actor).toMatchObject({
			kind: "aws_llm",
			isDoradsoft: false,
		});
	});
});
