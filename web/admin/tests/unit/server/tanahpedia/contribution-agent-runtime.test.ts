import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RegisteredContributionAgent } from "~/lib/tanahpedia/contribution-agents";
import type {
	Contribution,
	ContributionGeneration,
} from "~/lib/tanahpedia/contributions";

const mocks = vi.hoisted(() => ({
	query: vi.fn(),
	ensure: vi.fn(),
	read: vi.fn(),
	save: vi.fn(),
	agent: vi.fn(),
	queue: vi.fn(),
	aws: vi.fn(),
	transaction: vi.fn(),
}));
vi.mock("~/server/db", () => ({ query: mocks.query }));
vi.mock("~/server/tanahpedia/contribution-agent-registry.server", () => ({
	getAssignedContributionAgent: mocks.agent,
}));
vi.mock("~/server/tanahpedia/contribution-store.server", () => ({
	ensureContributionSchema: mocks.ensure,
	readContribution: mocks.read,
	saveContribution: mocks.save,
	withContributions: mocks.transaction,
}));
vi.mock("~/server/tanahpedia/contribution-service.server", () => ({
	queueAssignedContributionAgent: mocks.queue,
}));
vi.mock("~/server/tanahpedia/contribution-worker.server", () => ({
	runAwsContributionAgentTask: mocks.aws,
}));

import {
	createContributionAgentRuntime,
	reconcileContributionAgentAssignments,
} from "~/server/tanahpedia/contribution-agent-runtime.server";

type WorkResult = { status: "idle" | "completed" | "failed" };
const runtimes: ReturnType<typeof createContributionAgentRuntime>[] = [];
function runtime(run: () => Promise<WorkResult>, log = vi.fn()) {
	const value = createContributionAgentRuntime(run, log);
	runtimes.push(value);
	return value;
}
function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
const human = {
	id: "editor",
	name: "Editor",
	kind: "human" as const,
	isDoradsoft: false,
};
function contribution(
	number = 1,
	overrides: Partial<Contribution> = {},
): Contribution {
	return {
		id: `item-${number}`,
		number,
		kind: "issue",
		state: "open",
		title: "Issue",
		description: "Description",
		author: human,
		assignee: { kind: "local_llm" },
		evidence: [],
		changes: [],
		issueId: null,
		revision: 1,
		version: 1,
		events: [],
		createdAt: "2026-11-15T00:00:00Z",
		updatedAt: "2026-11-15T00:00:00Z",
		closeIssue: true,
		provenance: null,
		...overrides,
	};
}
function generation(
	overrides: Partial<ContributionGeneration> = {},
): ContributionGeneration {
	return {
		id: "job",
		status: "queued",
		task: "issue_implementation",
		agentId: "agent",
		agentVersion: 3,
		bundleHash: "current-hash",
		requestedAt: "2026-11-15T00:00:00Z",
		requestedBy: human.id,
		attempts: 0,
		apiVersion: 4,
		worker: null,
		model: null,
		leaseHash: null,
		leaseExpiresAt: null,
		claimedVersion: null,
		contextHash: null,
		outputHash: null,
		prIds: [],
		error: null,
		...overrides,
	};
}
function agent(
	overrides: Partial<RegisteredContributionAgent> = {},
): RegisteredContributionAgent {
	return {
		id: "agent",
		version: 3,
		name: "Agent",
		provider: "local_llm",
		model: "model",
		enabled: true,
		bundleHash: "current-hash",
		installedVersion: "bundle-v1",
		bundle: {
			protocolVersion: 2,
			version: "bundle-v1",
			hash: "current-hash",
			apiVersion: 4,
			system: "Instructions",
			operationGuide: [],
			tools: [],
		},
		createdAt: "now",
		updatedAt: "now",
		lastSeenAt: null,
		runtimeVersion: null,
		...overrides,
	};
}
let items: Map<string, Contribution>;
function scan(
	rows: Contribution[],
	lastNumber = Math.max(0, ...rows.map((item) => item.number)),
) {
	items = new Map(rows.map((item) => [item.id, item]));
	mocks.query.mockImplementation(async (_sql, args?: number[]) =>
		args
			? rows
					.filter((item) => item.number > args[0] && item.number <= args[1])
					.slice(0, 100)
					.map(({ id, number }) => ({ id, number }))
			: [{ lastNumber }],
	);
}
beforeEach(() => {
	vi.useFakeTimers();
	vi.resetAllMocks();
	items = new Map();
	mocks.transaction.mockImplementation(async (fn) =>
		fn({ connection: "transaction" }),
	);
	mocks.read.mockImplementation(async (_conn, id) =>
		structuredClone(items.get(id)),
	);
	mocks.agent.mockResolvedValue(agent());
	mocks.aws.mockResolvedValue({ status: "idle" });
	scan([]);
});
afterEach(() => {
	for (const value of runtimes.splice(0)) value.stop();
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe("serial AWS agent drain", () => {
	it("waits for a kick or the existing poll and drains completions until idle", async () => {
		const run = vi
			.fn()
			.mockResolvedValueOnce({ status: "completed" })
			.mockResolvedValueOnce({ status: "completed" })
			.mockResolvedValue({ status: "idle" });
		const worker = runtime(run);
		await worker.settled();
		expect(run).not.toHaveBeenCalled();
		worker.kick();
		await worker.settled();
		expect(run).toHaveBeenCalledTimes(3);
		await vi.advanceTimersByTimeAsync(29999);
		expect(run).toHaveBeenCalledTimes(3);
		await vi.advanceTimersByTimeAsync(1);
		expect(run).toHaveBeenCalledTimes(4);
	});
	it("coalesces concurrent notifications and polls while one task owns the drain", async () => {
		const first = deferred<WorkResult>();
		const run = vi
			.fn()
			.mockReturnValueOnce(first.promise)
			.mockResolvedValue({ status: "idle" });
		const worker = runtime(run);
		worker.kick();
		worker.kick();
		await vi.advanceTimersByTimeAsync(30000);
		worker.kick();
		expect(run).toHaveBeenCalledTimes(1);
		first.resolve({ status: "completed" });
		await worker.settled();
		expect(run).toHaveBeenCalledTimes(2);
	});
	it("ends a failed result without spinning and permits the next poll to inspect new work", async () => {
		const run = vi
			.fn()
			.mockResolvedValueOnce({ status: "failed" })
			.mockResolvedValue({ status: "idle" });
		const worker = runtime(run);
		worker.kick();
		await worker.settled();
		expect(run).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(29999);
		expect(run).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(run).toHaveBeenCalledTimes(2);
	});
	it.each([new Error("Provider unavailable"), "unknown rejection"])(
		"logs a thrown failure and releases the drain for a later poll",
		async (error) => {
			const log = vi.fn(),
				run = vi
					.fn()
					.mockRejectedValueOnce(error)
					.mockResolvedValue({ status: "idle" });
			const worker = runtime(run, log);
			worker.kick();
			await worker.settled();
			expect(log).toHaveBeenCalledWith(
				`Contribution agent runtime failed: ${error instanceof Error ? error.message : "unknown error"}`,
			);
			expect(run).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(30000);
			expect(run).toHaveBeenCalledTimes(2);
		},
	);
	it("stops polling and ignores future kicks", async () => {
		const run = vi.fn().mockResolvedValue({ status: "completed" });
		const worker = runtime(run);
		worker.stop();
		worker.kick();
		await vi.advanceTimersByTimeAsync(60000);
		await worker.settled();
		expect(run).not.toHaveBeenCalled();
	});
	it("allows an in-flight task to settle after stop without starting another", async () => {
		const first = deferred<WorkResult>(),
			run = vi.fn().mockReturnValue(first.promise);
		const worker = runtime(run);
		worker.kick();
		worker.stop();
		first.resolve({ status: "completed" });
		await worker.settled();
		expect(run).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(30000);
		expect(run).toHaveBeenCalledTimes(1);
	});
	it("starts the singleton once and routes subsequent notifications to it", async () => {
		vi.resetModules();
		const module = await import(
			"~/server/tanahpedia/contribution-agent-runtime.server"
		);
		module.notifyContributionAgentWork();
		expect(mocks.aws).not.toHaveBeenCalled();
		module.ensureContributionAgentRuntimeStarted();
		module.ensureContributionAgentRuntimeStarted();
		await vi.advanceTimersByTimeAsync(0);
		expect(mocks.aws).toHaveBeenCalledTimes(1);
		module.notifyContributionAgentWork();
		await vi.advanceTimersByTimeAsync(0);
		expect(mocks.aws).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(30000);
		expect(mocks.aws).toHaveBeenCalledTimes(3);
	});
});

describe("deployment/config assignment reconciliation", () => {
	it("does nothing for an empty database after ensuring its schema", async () => {
		expect(await reconcileContributionAgentAssignments()).toEqual({
			scanned: 0,
			queued: 0,
		});
		expect(mocks.ensure).toHaveBeenCalledOnce();
		expect(mocks.read).not.toHaveBeenCalled();
	});
	it("backfills current and legacy open assignments with no work while preserving their author", async () => {
		scan([
			contribution(1),
			contribution(2, { apiVersion: undefined, assignee: { kind: "aws_llm" } }),
		]);
		expect(await reconcileContributionAgentAssignments()).toEqual({
			scanned: 2,
			queued: 2,
		});
		expect(mocks.queue).toHaveBeenCalledTimes(2);
		expect(mocks.save).toHaveBeenCalledTimes(2);
		for (const call of mocks.queue.mock.calls) {
			expect(call[1].author).toEqual(human);
			expect(call[2]).toEqual({
				id: "system:agent-release",
				name: "Agent release",
				kind: "system",
				isDoradsoft: false,
			});
			expect(call[3]).toBe("assignment");
		}
		expect(mocks.read).toHaveBeenCalledWith(expect.anything(), "item-1", true);
	});
	it.each([
		{ status: "queued" as const, agentId: "old-agent" },
		{ status: "running" as const, agentId: "old-agent" },
		{ status: "queued" as const, bundleHash: "old-hash" },
		{ status: "running" as const, bundleHash: "old-hash" },
		{ status: "queued" as const, agentVersion: 2 },
		{ status: "running" as const, agentVersion: 2 },
	])(
		"revokes an active task with stale agent, bundle or config identity: %j",
		async (changed) => {
			scan([contribution(1, { generation: generation(changed) })]);
			expect(await reconcileContributionAgentAssignments()).toEqual({
				scanned: 1,
				queued: 1,
			});
			expect(mocks.queue).toHaveBeenCalledOnce();
			expect(mocks.save).toHaveBeenCalledOnce();
		},
	);
	it.each(["queued", "running"] as const)(
		"leaves a matching active %s task unchanged",
		async (status) => {
			scan([contribution(1, { generation: generation({ status }) })]);
			expect(await reconcileContributionAgentAssignments()).toEqual({
				scanned: 1,
				queued: 0,
			});
			expect(mocks.save).not.toHaveBeenCalled();
		},
	);
	it.each([{ enabled: false }, { model: null }])(
		"re-evaluates active work when its agent cannot run: %j",
		async (config) => {
			mocks.agent.mockResolvedValue(agent(config));
			scan([contribution(1, { generation: generation() })]);
			expect(await reconcileContributionAgentAssignments()).toEqual({
				scanned: 1,
				queued: 1,
			});
			expect(mocks.queue).toHaveBeenCalledOnce();
		},
	);
	it("resumes needs_input only after an explicit update to that same agent", async () => {
		scan([
			contribution(1, { generation: generation({ status: "needs_input" }) }),
		]);
		expect(await reconcileContributionAgentAssignments()).toEqual({
			scanned: 1,
			queued: 0,
		});
		expect(await reconcileContributionAgentAssignments("other-agent")).toEqual({
			scanned: 1,
			queued: 0,
		});
		expect(await reconcileContributionAgentAssignments("agent")).toEqual({
			scanned: 1,
			queued: 1,
		});
		expect(mocks.queue).toHaveBeenCalledOnce();
	});
	it.each(["completed", "failed", "cancelled"] as const)(
		"preserves a terminal %s result even when the configuration changed",
		async (status) => {
			scan([
				contribution(1, {
					generation: generation({ status, bundleHash: "old-hash" }),
				}),
			]);
			mocks.agent.mockResolvedValue(agent({ enabled: false }));
			expect(await reconcileContributionAgentAssignments()).toEqual({
				scanned: 1,
				queued: 0,
			});
			expect(mocks.queue).not.toHaveBeenCalled();
		},
	);
	it.each(["queued", "running"] as const)(
		"preserves a runnable legacy %s task with no new protocol identity",
		async (status) => {
			scan([
				contribution(1, {
					generation: generation({
						status,
						task: undefined,
						agentId: undefined,
						agentVersion: undefined,
						bundleHash: undefined,
					}),
				}),
			]);
			expect(await reconcileContributionAgentAssignments()).toEqual({
				scanned: 1,
				queued: 0,
			});
			expect(mocks.save).not.toHaveBeenCalled();
		},
	);
	it("filters a config update to its registered agent", async () => {
		scan([contribution(1), contribution(2)]);
		mocks.agent
			.mockResolvedValueOnce(agent({ id: "other-agent" }))
			.mockResolvedValueOnce(agent());
		expect(await reconcileContributionAgentAssignments("agent")).toEqual({
			scanned: 2,
			queued: 1,
		});
		expect(mocks.save.mock.calls.map((call) => call[1].id)).toEqual(["item-2"]);
	});
	it.each([
		{ state: "closed" as const },
		{ assignee: { kind: "unassigned" as const } },
		{ assignee: { kind: "human" as const, id: "editor", name: "Editor" } },
	])(
		"rechecks state and assignment under the transaction after a selection race: %j",
		async (changed) => {
			scan([contribution(1, changed)]);
			expect(await reconcileContributionAgentAssignments()).toEqual({
				scanned: 1,
				queued: 0,
			});
			expect(mocks.agent).not.toHaveBeenCalled();
			expect(mocks.save).not.toHaveBeenCalled();
		},
	);
	it("walks bounded keyset pages exactly once and excludes later inserted rows", async () => {
		scan(
			Array.from({ length: 103 }, (_, index) => contribution(index + 1)),
			102,
		);
		expect(await reconcileContributionAgentAssignments()).toEqual({
			scanned: 102,
			queued: 102,
		});
		expect(mocks.query.mock.calls.slice(1).map((call) => call[1])).toEqual([
			[0, 102],
			[100, 102],
		]);
		expect(new Set(mocks.read.mock.calls.map((call) => call[1])).size).toBe(
			102,
		);
		expect(mocks.read).not.toHaveBeenCalledWith(
			expect.anything(),
			"item-103",
			true,
		);
		expect(mocks.query.mock.calls[1][0]).toContain("ORDER BY number LIMIT 100");
	});
	it("ends a scan at an empty later page despite gaps below the original upper bound", async () => {
		scan([contribution(5)], 100);
		expect(await reconcileContributionAgentAssignments()).toEqual({
			scanned: 1,
			queued: 1,
		});
		expect(mocks.query).toHaveBeenCalledTimes(3);
	});
	it("propagates storage failure instead of reporting a successful release reconciliation", async () => {
		scan([contribution(1)]);
		mocks.save.mockRejectedValue(new Error("Database unavailable"));
		await expect(reconcileContributionAgentAssignments()).rejects.toThrow(
			"Database unavailable",
		);
	});
});
