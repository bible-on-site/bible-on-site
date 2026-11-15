import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRIBUTION_API_VERSION } from "~/lib/tanahpedia/contribution-api";
import type {
	Contribution,
	Contributor,
	ReviewedChange,
} from "~/lib/tanahpedia/contributions";

vi.mock("~/server/tanahpedia/contribution-rebases.server", () => ({
	resumePendingContributionRebases: vi.fn().mockResolvedValue(undefined),
}));

const mocks = vi.hoisted(() => ({
	items: new Map<string, Contribution>(),
	lockedReads: [] as string[],
	prepare: vi.fn(),
	read: vi.fn(),
	apply: vi.fn(),
	revalidate: vi.fn(),
	people: vi.fn(),
	entities: vi.fn(),
	entries: vi.fn(),
	query: vi.fn(),
	afterTransaction: vi.fn(),
	agent: vi.fn(),
	notify: vi.fn(),
}));
vi.mock("~/server/tanahpedia/contribution-agent-registry.server", () => ({
	getAssignedContributionAgent: mocks.agent,
}));
vi.mock("~/server/tanahpedia/contribution-agent-runtime.server", () => ({
	notifyContributionAgentWork: mocks.notify,
}));
vi.mock("~/server/tanahpedia/contribution-store.server", () => ({
	withContributions: async (fn: (conn: object) => Promise<unknown>) => {
		const previous = structuredClone(mocks.items);
		try {
			const result = await fn({});
			await mocks.afterTransaction();
			return result;
		} catch (error) {
			mocks.items.clear();
			for (const [id, item] of previous) mocks.items.set(id, item);
			throw error;
		}
	},
	readContribution: async (_conn: object, id: string, lock = false) => {
		if (lock) mocks.lockedReads.push(id);
		const item = mocks.items.get(id);
		if (!item) throw new Error("not found");
		return structuredClone(item);
	},
	insertContribution: async (_conn: object, item: Contribution) => {
		const saved = { ...item, number: mocks.items.size + 1 };
		mocks.items.set(item.id, structuredClone(saved));
		return saved;
	},
	saveContribution: async (_conn: object, item: Contribution) => {
		item.version += 1;
		mocks.items.set(item.id, structuredClone(item));
		return item;
	},
}));
vi.mock("~/server/tanahpedia/contribution-changes.server", () => ({
	prepareChanges: mocks.prepare,
	readChangeState: mocks.read,
	applyChange: mocks.apply,
	assertMetadataNames: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/server/db", () => ({ query: mocks.query }));
vi.mock("~/server/website-revalidate", () => ({
	revalidateWebsite: mocks.revalidate,
	pediaInvalidation: () => [{ path: "/pedia/[slug]", type: "page" }],
}));
vi.mock("~/server/tanahpedia/paths", () => ({
	pediaChangesForPersons: mocks.people,
	pediaChangesForEntities: mocks.entities,
	pediaChangesForEntryIds: mocks.entries,
}));

import {
	addEvent,
	applyContributionAgentRevision,
	assertVersion,
	createContribution,
	editContribution,
	mergeContribution,
	recoverContributionSequence,
	updateContribution,
} from "~/server/tanahpedia/contribution-service.server";

const ID = "00000000-0000-4000-8000-000000000001",
	OTHER = "00000000-0000-4000-8000-000000000002";
const alice: Contributor = {
	id: "alice",
	name: "Alice",
	kind: "human",
	isDoradsoft: false,
};
const owner: Contributor = {
	id: "owner",
	name: "doradsoft",
	kind: "human",
	isDoradsoft: true,
};
const evidence = [{ citation: "מקור", quote: "", url: null, note: "" }];
const change: ReviewedChange = {
	kind: "metadata",
	targetId: ID,
	before: { displayName: "old" },
	after: { displayName: "new" },
	labels: {},
	personNames: [],
};
const input = {
	kind: "pr",
	title: "Title",
	description: "Description",
	evidence,
	changes: [{ kind: "metadata", targetId: ID, after: { displayName: "new" } }],
};
async function pr(actor = alice) {
	return createContribution(input, actor);
}
it.each([null, Array(41).fill(change)])(
	"rejects invalid raw-recovery sequence bounds before loading a proposal",
	async (sequence) => {
		await expect(
			recoverContributionSequence(
				{ id: ID, version: 1, apiVersion: CONTRIBUTION_API_VERSION, sequence },
				alice,
			),
		).rejects.toThrow("Recovery requires at most 40 operations");
	},
);

it("recovers a gray PR by re-preparing its base and recording an authored revision", async () => {
	const item = await pr();
	item.apiVersion = CONTRIBUTION_API_VERSION + 1;
	mocks.items.set(item.id, structuredClone(item));
	const repaired = await recoverContributionSequence(
		{
			id: item.id,
			version: item.version,
			apiVersion: CONTRIBUTION_API_VERSION,
			sequence: [change],
		},
		alice,
	);
	expect(repaired.apiVersion).toBe(CONTRIBUTION_API_VERSION);
	expect(repaired.apiMigration).toBeUndefined();
	expect(repaired.revision).toBe(item.revision + 1);
	expect(repaired.events.at(-1)?.kind).toBe("edited");
	expect(mocks.prepare).toHaveBeenLastCalledWith({}, [
		{ kind: "metadata", targetId: ID, after: { displayName: "new" } },
	]);
});
it("rejects recovery targeting an old API or a compatible/finalized PR", async () => {
	const item = await pr();
	await expect(
		recoverContributionSequence(
			{
				id: item.id,
				version: item.version,
				apiVersion: CONTRIBUTION_API_VERSION + 1,
				sequence: [change],
			},
			alice,
		),
	).rejects.toThrow("latest API");
	await expect(
		recoverContributionSequence(
			{
				id: item.id,
				version: item.version,
				apiVersion: CONTRIBUTION_API_VERSION,
				sequence: [change],
			},
			alice,
		),
	).rejects.toThrow("incompatible open PR");
});
async function issue() {
	return createContribution(
		{ kind: "issue", title: "Issue", description: "Description" },
		alice,
	);
}
const action = (item: Contribution, name: string, extra = {}) => ({
	id: item.id,
	version: item.version,
	action: name,
	...extra,
});

describe("contribution lifecycle", () => {
	beforeEach(() => {
		mocks.items.clear();
		mocks.lockedReads.length = 0;
		for (const mock of [
			mocks.prepare,
			mocks.read,
			mocks.apply,
			mocks.revalidate,
			mocks.people,
			mocks.entities,
			mocks.entries,
			mocks.query,
			mocks.afterTransaction,
			mocks.agent,
			mocks.notify,
		])
			mock.mockReset();
		mocks.prepare.mockImplementation(async (_conn, inputs) =>
			inputs.length ? [structuredClone(change)] : [],
		);
		mocks.read.mockResolvedValue(change.before);
		mocks.people.mockResolvedValue([]);
		mocks.entities.mockResolvedValue([]);
		mocks.entries.mockResolvedValue([]);
		mocks.query.mockResolvedValue([]);
		mocks.agent.mockImplementation(async (_conn, assignee) => ({
			id: ID,
			version: 1,
			provider: assignee.kind,
			model: "configured:model",
			enabled: true,
			installedVersion: "agents-v1",
			bundleHash: "a".repeat(64),
		}));
	});
	afterEach(() => vi.restoreAllMocks());
	it.each(["issue", "pr"])(
		"creating an assigned %s queues its implementation task atomically",
		async (kind) => {
			let committed = false;
			mocks.afterTransaction.mockImplementation(async () => {
				committed = true;
			});
			mocks.notify.mockImplementation(() => expect(committed).toBe(true));
			const item = await createContribution(
				{ ...input, kind, assignee: { kind: "local_llm" } },
				alice,
			);
			expect(item.generation).toMatchObject({
				status: "queued",
				task: kind === "issue" ? "issue_implementation" : "pr_resolution",
				agentId: ID,
				agentVersion: 1,
				bundleVersion: "agents-v1",
				trigger: "assignment",
				attempts: 0,
			});
			expect(item.events.at(-1)?.run?.jobId).toBe(item.generation?.id);
			expect(mocks.notify).toHaveBeenCalledOnce();
			expect(mocks.apply).not.toHaveBeenCalled();
		},
	);
	it("human feedback replaces the old lease and retains pending trigger IDs without loops from model replies", async () => {
		let item = await createContribution(
			{ ...input, assignee: { kind: "local_llm" } },
			alice,
		);
		const previousId = item.generation?.id;
		item = await updateContribution(
			action(item, "comment", { body: "Fix this fact" }),
			alice,
		);
		expect(item.generation?.id).not.toBe(previousId);
		const feedback = item.events
			.filter((event) => event.kind === "comment")
			.at(-1);
		expect(item.generation?.triggerEventIds).toContain(feedback?.id);
		expect(item.revision).toBe(1);
		const request = structuredClone(item.generation);
		item = await updateContribution(
			action(item, "comment", { body: "Working on it" }),
			{ ...alice, kind: "local_llm" },
		);
		expect(item.generation).toEqual(request);
	});
	it("owner change requests enqueue feedback while approval alone does not launch another pass", async () => {
		let item = await createContribution(
			{ ...input, assignee: { kind: "aws_llm" } },
			alice,
		);
		item = await updateContribution(
			action(item, "request_changes", { body: "Please correct the date" }),
			owner,
		);
		expect(item.generation?.triggerEventIds).toContain(
			item.events.filter((event) => event.kind === "changes_requested").at(-1)
				?.id,
		);
		const jobId = item.generation?.id;
		item = await updateContribution(action(item, "approve"), owner);
		expect(item.generation?.id).toBe(jobId);
	});
	it("explicit reassignment/rerun refreshes work, and closing/unassigning revokes it", async () => {
		let item = await createContribution(
			{ ...input, assignee: { kind: "local_llm" } },
			alice,
		);
		const first = item.generation?.id;
		item = await updateContribution(
			action(item, "assign", { assignee: item.assignee }),
			alice,
		);
		expect(item.generation?.id).not.toBe(first);
		item = await updateContribution(action(item, "run_agent"), alice);
		expect(item.generation?.trigger).toBe("manual");
		item = await updateContribution(action(item, "close"), alice);
		expect(item.generation?.status).toBe("cancelled");
		item = await updateContribution(action(item, "reopen"), alice);
		expect(item.generation).toMatchObject({
			status: "queued",
			trigger: "reopen",
		});
		item = await updateContribution(
			action(item, "assign", { assignee: { kind: "unassigned" } }),
			alice,
		);
		expect(item.generation?.status).toBe("cancelled");
		await expect(
			updateContribution(action(item, "run_agent"), alice),
		).rejects.toThrow("assigned");
	});
	it.each(["disabled", "missing model"])(
		"saves assignments needing %s configuration without pretending to execute",
		async (reason) => {
			mocks.agent.mockResolvedValue({
				id: ID,
				version: 1,
				provider: "aws_llm",
				model: reason === "missing model" ? null : "model",
				enabled: reason !== "disabled",
				installedVersion: "v1",
				bundleHash: "a".repeat(64),
			});
			const item = await createContribution(
				{
					kind: "issue",
					title: "Issue",
					description: "Implement",
					assignee: { kind: "aws_llm" },
				},
				alice,
			);
			expect(item.generation?.status).toBe("needs_input");
			expect(item.generation?.error).toBeTruthy();
			expect(mocks.notify).not.toHaveBeenCalled();
		},
	);
	it("a model-authored no-op response retains approval, while an actual revision records fresh model authorship", async () => {
		let item = await pr();
		item = await updateContribution(action(item, "approve"), owner);
		const modelActor: Contributor = {
			id: "agent:model",
			name: "Local reviewer",
			kind: "local_llm",
			isDoradsoft: false,
		};
		const prior = structuredClone(item);
		expect(
			await applyContributionAgentRevision({} as never, item, {}, modelActor),
		).toBe(false);
		expect(item).toEqual(prior);
		expect(
			await applyContributionAgentRevision(
				{} as never,
				item,
				{ description: "Corrected explanation" },
				modelActor,
			),
		).toBe(true);
		expect(item.revision).toBe(2);
		expect(item.revisionAuthor).toEqual(modelActor);
		expect(item.revisionHistory?.at(-1)?.description).toBe(prior.description);
		expect(
			item.events.find((event) => event.kind === "approved")?.snapshot
				?.revision,
		).toBe(1);
		await expect(
			applyContributionAgentRevision({} as never, item, {}, owner),
		).rejects.toThrow("model authorship");
		item.state = "closed";
		await expect(
			applyContributionAgentRevision({} as never, item, {}, modelActor),
		).rejects.toThrow("open PR");
	});
	it("description-only edits preserve a successful API migration that retired all operations", async () => {
		let item = await pr();
		item.changes = [];
		item.apiMigration = {
			id: ID,
			status: "succeeded",
			from: 3,
			to: CONTRIBUTION_API_VERSION,
			at: new Date().toISOString(),
			steps: [],
			error: null,
			sequence: JSON.stringify([change]),
		};
		mocks.items.set(item.id, structuredClone(item));
		item = await editContribution(
			{
				...input,
				id: item.id,
				version: item.version,
				changes: [],
				description: "Obsolete request explained",
			},
			alice,
		);
		expect(item.changes).toEqual([]);
		expect(item.apiMigration?.status).toBe("succeeded");
		const modelActor: Contributor = {
			id: "agent",
			name: "Agent",
			kind: "local_llm",
			isDoradsoft: false,
		};
		expect(
			await applyContributionAgentRevision(
				{} as never,
				item,
				{ description: "Further explanation" },
				modelActor,
			),
		).toBe(true);
		expect(item.changes).toEqual([]);
		expect(item.apiMigration?.status).toBe("succeeded");
		await expect(
			applyContributionAgentRevision(
				{} as never,
				item,
				{ evidence: [] },
				modelActor,
			),
		).rejects.toThrow("evidence");
	});
	it("manual raw recovery atomically replaces failed assigned work and wakes it after commit", async () => {
		let item = await createContribution(
			{ ...input, assignee: { kind: "local_llm" } },
			alice,
		);
		item.apiVersion = CONTRIBUTION_API_VERSION + 1;
		if (!item.generation) throw new Error("Missing assigned task");
		item.generation.status = "failed";
		const previousJob = item.generation.id;
		mocks.items.set(item.id, structuredClone(item));
		mocks.notify.mockClear();
		item = await recoverContributionSequence(
			{
				id: item.id,
				version: item.version,
				apiVersion: CONTRIBUTION_API_VERSION,
				sequence: [change],
			},
			alice,
		);
		expect(item.generation).toMatchObject({
			status: "queued",
			trigger: "edit",
			task: "pr_resolution",
		});
		expect(item.generation?.id).not.toBe(previousJob);
		expect(item.generation?.triggerEventIds).toContain(
			item.events.filter((event) => event.kind === "edited").at(-1)?.id,
		);
		expect(mocks.notify).toHaveBeenCalledOnce();
	});
	it("legacy generation cannot strip versioned agent metadata from an already modern task", async () => {
		const item = await createContribution(
			{
				kind: "issue",
				title: "Issue",
				description: "Implement",
				evidence,
				assignee: { kind: "local_llm" },
			},
			alice,
		);
		if (!item.generation) throw new Error("Missing assigned task");
		item.generation.status = "completed";
		mocks.items.set(item.id, structuredClone(item));
		await expect(
			updateContribution(action(item, "queue_generation"), alice),
		).rejects.toThrow("run_agent");
		expect(mocks.items.get(item.id)?.generation).toEqual(item.generation);
	});
	it("retains immutable authored snapshots and the exact proposal attached to an approval", async () => {
		let item = await pr();
		item = await updateContribution(action(item, "approve"), owner);
		const approval = structuredClone(item.events.at(-1)?.snapshot);
		const edited = await editContribution(
			{
				...input,
				id: item.id,
				version: item.version,
				description: "Changed description",
				evidence: [{ citation: "Other source", quote: "Other quote" }],
			},
			alice,
		);
		expect(edited.revisionHistory?.[0]).toMatchObject({
			revision: 1,
			description: input.description,
			evidence,
			changes: [change],
		});
		expect(
			edited.events.find((event) => event.kind === "approved")?.snapshot,
		).toEqual(approval);
		expect(
			edited.events.find((event) => event.kind === "approved")?.snapshot
				?.evidence,
		).toEqual(evidence);
		expect(edited.description).toBe("Changed description");
	});
	it("saves assignee-only edits without invalidating a reviewed revision", async () => {
		let item = await pr();
		item = await updateContribution(action(item, "approve"), owner);
		const assigned = await editContribution(
			{
				...input,
				id: item.id,
				version: item.version,
				assignee: { kind: "local_llm" },
			},
			alice,
		);
		expect(assigned.assignee.kind).toBe("local_llm");
		expect(assigned.revision).toBe(item.revision);
		expect(assigned.events.at(-2)?.kind).toBe("assigned");
		expect(assigned.events.at(-1)?.kind).toBe("generation_queued");
		await expect(
			mergeContribution({ id: assigned.id, version: assigned.version }, alice),
		).rejects.toThrow(/agent|סוכן/i);
		const released = await updateContribution(
			action(assigned, "assign", { assignee: { kind: "unassigned" } }),
			alice,
		);
		await expect(
			mergeContribution({ id: released.id, version: released.version }, alice),
		).resolves.toMatchObject({ state: "merged" });
	});
	it("preserves pre-upgrade explicit worker requests, duplicate protection and lost-lease recovery", async () => {
		let item = await createContribution(
			{
				kind: "issue",
				title: "Issue",
				description: "Saved source",
				evidence,
				assignee: { kind: "unassigned" },
			},
			alice,
		);
		// This fixture represents a persisted assignment from before automatic work.
		item.assignee = { kind: "local_llm" };
		mocks.items.set(item.id, structuredClone(item));
		item = await updateContribution(action(item, "queue_generation"), alice);
		expect(item.generation).toMatchObject({
			status: "queued",
			attempts: 0,
			requestedBy: alice.id,
			apiVersion: CONTRIBUTION_API_VERSION,
		});
		expect(item.events.at(-1)?.kind).toBe("generation_queued");
		await expect(
			updateContribution(action(item, "queue_generation"), alice),
		).rejects.toThrow("already queued");
		if (!item.generation) throw new Error("Missing fixture generation");
		item.generation.status = "running";
		item.generation.leaseExpiresAt = new Date(Date.now() + 60000).toISOString();
		mocks.items.set(item.id, structuredClone(item));
		await expect(
			updateContribution(action(item, "queue_generation"), alice),
		).rejects.toThrow("already queued");
		item.generation.leaseExpiresAt = "2000-01-01T00:00:00Z";
		mocks.items.set(item.id, structuredClone(item));
		const retry = await updateContribution(
			action(item, "queue_generation"),
			alice,
		);
		expect(retry.generation?.id).not.toBe(item.generation.id);
		expect(retry.generation?.attempts).toBe(0);
		expect(mocks.apply).not.toHaveBeenCalled();
	});
	it.each(["no evidence", "human assignee", "model actor", "closed", "pr"])(
		"rejects unsuitable worker requests: %s",
		async (reason) => {
			const item = await createContribution(
				{
					kind: "issue",
					title: "Issue",
					description: "Description",
					evidence: reason === "no evidence" ? [] : evidence,
					assignee: { kind: "local_llm" },
				},
				alice,
			);
			if (reason === "human assignee") item.assignee = { kind: "unassigned" };
			if (reason === "closed") item.state = "closed";
			if (reason === "pr") item.kind = "pr";
			mocks.items.set(item.id, structuredClone(item));
			const generation = structuredClone(item.generation);
			await expect(
				updateContribution(
					action(item, "queue_generation"),
					reason === "model actor" ? { ...alice, kind: "local_llm" } : alice,
				),
			).rejects.toThrow();
			expect(mocks.items.get(item.id)?.generation).toEqual(generation);
		},
	);
	it("creates an issue without touching content and records assignment", async () => {
		const value = await createContribution(
			{
				kind: "issue",
				title: " Issue ",
				description: " Description ",
				assignee: { kind: "local_llm" },
			},
			alice,
		);
		expect(value).toMatchObject({
			kind: "issue",
			title: "Issue",
			assignee: { kind: "local_llm" },
			author: alice,
		});
		expect(value.events[0].kind).toBe("created");
		expect(mocks.apply).not.toHaveBeenCalled();
	});
	it("ignores forged author and approval properties from the request", async () => {
		const value = await createContribution(
			{ ...input, author: owner, approved: true },
			alice,
		);
		expect(value.author).toEqual(alice);
		expect(value.events).toHaveLength(1);
	});
	it.each([
		{ ...input, kind: "unknown" },
		{ ...input, evidence: [] },
		{ ...input, kind: "issue", issueId: ID },
	])("rejects malformed creation %j", async (value) => {
		await expect(createContribution(value, alice)).rejects.toThrow();
		expect(mocks.items.size).toBe(0);
	});
	it("only links PRs to open issues", async () => {
		const item = await issue();
		const value = await createContribution(
			{ ...input, issueId: item.id, issueVersion: item.version },
			alice,
		);
		expect(value.issueId).toBe(item.id);
		const closed = await updateContribution(action(item, "close"), alice);
		await expect(
			createContribution({ ...input, issueId: closed.id }, alice),
		).rejects.toThrow("open");
	});
	it("rejects a stale linked issue version", async () => {
		const item = await issue();
		await expect(
			createContribution(
				{ ...input, issueId: item.id, issueVersion: 99 },
				alice,
			),
		).rejects.toThrow("Reload");
	});
	it("stores comments without changing the review revision", async () => {
		const item = await pr();
		const updated = await updateContribution(
			action(item, "comment", { body: " New information " }),
			alice,
		);
		expect(updated.events.at(-1)?.body).toBe("New information");
		expect(updated.revision).toBe(1);
	});
	it("assigns all four supported categories", async () => {
		let item = await issue();
		for (const assignee of [
			{ kind: "human", id: "bob", name: "Bob" },
			{ kind: "aws_llm" },
			{ kind: "local_llm" },
			{ kind: "unassigned" },
		]) {
			item = await updateContribution(
				action(item, "assign", { assignee }),
				alice,
			);
			expect(item.assignee).toEqual(assignee);
			expect(item.events.some((event) => event.kind === "assigned")).toBe(true);
			if (assignee.kind.endsWith("llm"))
				expect(item.generation?.status).toBe("queued");
		}
	});
	it("rejects stale updates", async () => {
		const item = await issue();
		await updateContribution(
			action(item, "comment", { body: "Comment" }),
			alice,
		);
		await expect(
			updateContribution(action(item, "close"), alice),
		).rejects.toThrow("Reload");
	});
	it("closes and reopens with a fresh review revision", async () => {
		let item = await pr();
		item = await updateContribution(action(item, "close"), alice);
		await expect(
			updateContribution(
				action(item, "assign", { assignee: { kind: "unassigned" } }),
				alice,
			),
		).rejects.toThrow("open");
		await expect(
			updateContribution(action(item, "close"), alice),
		).rejects.toThrow("already");
		item = await updateContribution(action(item, "reopen"), alice);
		expect(item.revision).toBe(2);
		await expect(
			updateContribution(action(item, "reopen"), alice),
		).rejects.toThrow("closed");
	});
	it("only accepts supported lifecycle actions", async () => {
		const item = await issue();
		await expect(
			updateContribution(action(item, "delete_everything"), owner),
		).rejects.toThrow("Unsupported");
	});
	it("limits reviews to owner humans on open PRs", async () => {
		const item = await pr();
		await expect(
			updateContribution(action(item, "approve"), alice),
		).rejects.toThrow("doradsoft");
		await expect(
			updateContribution(action(item, "approve"), {
				...owner,
				kind: "local_llm",
			}),
		).rejects.toThrow("doradsoft");
		const other = await issue();
		await expect(
			updateContribution(action(other, "approve"), owner),
		).rejects.toThrow("open PRs");
	});
	it("records approval and a later request for changes", async () => {
		let item = await pr();
		item = await updateContribution(
			action(item, "approve", { body: " Approved " }),
			owner,
		);
		expect(item.events.at(-1)).toMatchObject({
			kind: "approved",
			body: "Approved",
			revision: 1,
		});
		item = await updateContribution(action(item, "request_changes"), owner);
		await expect(
			mergeContribution({ id: item.id, version: item.version }, owner),
		).rejects.toThrow("Approval");
	});
	it("edits invalidate prior approvals while no-op edits preserve them", async () => {
		let item = await pr();
		item = await updateContribution(action(item, "approve"), owner);
		const unchanged = await editContribution(
			{ ...input, id: item.id, version: item.version },
			alice,
		);
		expect(unchanged.version).toBe(item.version);
		item = await editContribution(
			{ ...input, title: "Revised", id: item.id, version: item.version },
			alice,
		);
		expect(item.revision).toBe(2);
		await expect(
			mergeContribution({ id: item.id, version: item.version }, owner),
		).rejects.toThrow("Approval");
	});
	it("rejects edits without evidence or after closure", async () => {
		const item = await pr();
		await expect(
			editContribution(
				{ ...input, evidence: [], id: item.id, version: item.version },
				alice,
			),
		).rejects.toThrow("evidence");
		const closed = await updateContribution(action(item, "close"), alice);
		await expect(
			editContribution(
				{ ...input, id: closed.id, version: closed.version },
				alice,
			),
		).rejects.toThrow("Reopen");
	});
	it("records issue edits without preparing changes", async () => {
		const item = await issue();
		const updated = await editContribution(
			{
				id: item.id,
				version: item.version,
				title: "New issue",
				description: "Updated",
				evidence,
			},
			alice,
		);
		expect(updated.title).toBe("New issue");
		expect(updated.changes).toEqual([]);
	});
	it("requires approval and rejects moved targets before calling any API operation", async () => {
		let item = await pr();
		await expect(
			mergeContribution({ id: item.id, version: item.version }, alice),
		).rejects.toThrow("Approval");
		item = await updateContribution(action(item, "approve"), owner);
		mocks.read.mockResolvedValue({ displayName: "someone else's save" });
		await expect(
			mergeContribution({ id: item.id, version: item.version }, alice),
		).rejects.toThrow("Conflict");
		expect(mocks.apply).not.toHaveBeenCalled();
	});
	it("rejects an authored edit between migration preflight and content locking", async () => {
		const item = await pr(owner);
		mocks.afterTransaction.mockImplementationOnce(() => {
			const edited = mocks.items.get(item.id);
			if (!edited) throw new Error("Missing fixture");
			edited.version++;
			edited.revision++;
			edited.revisionAuthor = alice;
			edited.description = "Concurrent authored edit";
		});
		await expect(
			mergeContribution({ id: item.id, version: item.version }, owner),
		).rejects.toThrow("Reload");
		expect(mocks.apply).not.toHaveBeenCalled();
		expect(mocks.items.get(item.id)?.description).toBe(
			"Concurrent authored edit",
		);
	});
	it("retains an automatic API upgrade when the later content transaction fails", async () => {
		const item = await pr(owner);
		item.apiVersion = 2;
		mocks.items.set(item.id, structuredClone(item));
		mocks.apply.mockRejectedValue(new Error("FK failure"));
		await expect(
			mergeContribution({ id: item.id, version: item.version }, owner),
		).rejects.toThrow("FK failure");
		const saved = mocks.items.get(item.id);
		expect(saved?.apiVersion).toBe(CONTRIBUTION_API_VERSION);
		expect(saved?.apiMigration?.status).toBe("succeeded");
		expect(saved?.revision).toBe(item.revision);
		expect(saved?.events).toEqual(item.events);
		expect(saved?.state).toBe("open");
	});
	it("applies an approved operation and invalidates only after commit", async () => {
		let item = await pr();
		item = await updateContribution(action(item, "approve"), owner);
		const merged = await mergeContribution(
			{ id: item.id, version: item.version },
			alice,
		);
		expect(merged.state).toBe("merged");
		expect(mocks.apply).toHaveBeenCalledWith(
			expect.anything(),
			change,
			`contribution-pr:${item.number}`,
		);
		expect(mocks.entities).toHaveBeenCalledWith([ID]);
		expect(mocks.revalidate).toHaveBeenCalledWith([]);
	});
	it("allows owner-authored PRs without reviews and closes linked issues", async () => {
		const linked = await issue();
		const item = await createContribution(
			{ ...input, issueId: linked.id },
			owner,
		);
		await mergeContribution({ id: item.id, version: item.version }, owner);
		expect(mocks.items.get(linked.id)?.state).toBe("closed");
		expect(mocks.lockedReads.slice(-2)).toEqual([linked.id, item.id]);
	});
	it("requires review when another editor changes an owner-authored PR", async () => {
		const original = await pr(owner);
		const edited = await editContribution(
			{
				...input,
				id: original.id,
				version: original.version,
				title: "Edited by Alice",
			},
			alice,
		);
		expect(edited.author.isDoradsoft).toBe(true);
		expect(edited.revisionAuthor).toEqual(alice);
		await expect(
			mergeContribution({ id: edited.id, version: edited.version }, alice),
		).rejects.toThrow("Approval from doradsoft");
	});
	it("preserves a committed merge and invalidates pedia if cache-target resolution fails", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const item = await pr(owner);
		mocks.entities.mockRejectedValueOnce(new Error("unavailable"));
		expect(
			(await mergeContribution({ id: item.id, version: item.version }, owner))
				.state,
		).toBe("merged");
		expect(mocks.items.get(item.id)?.state).toBe("merged");
		expect(mocks.revalidate).toHaveBeenLastCalledWith([
			{ path: "/pedia/[slug]", type: "page" },
		]);
		log.mockRestore();
	});
	it("respects the choice to leave the source issue open", async () => {
		const linked = await issue();
		const item = await createContribution(
			{ ...input, issueId: linked.id, closeIssue: false },
			owner,
		);
		await mergeContribution({ id: item.id, version: item.version }, owner);
		expect(mocks.items.get(linked.id)?.state).toBe("open");
		expect(mocks.lockedReads.slice(-2)).toEqual([linked.id, item.id]);
	});
	it("keeps an already-closed source issue unchanged", async () => {
		let linked = await issue();
		const item = await createContribution(
			{ ...input, issueId: linked.id },
			owner,
		);
		linked = await updateContribution(action(linked, "close"), alice);
		await mergeContribution({ id: item.id, version: item.version }, owner);
		expect(mocks.items.get(linked.id)?.version).toBe(linked.version);
	});
	it("retains an open PR when a typed operation fails", async () => {
		const item = await pr(owner);
		mocks.apply.mockRejectedValue(new Error("FK failure"));
		await expect(
			mergeContribution({ id: item.id, version: item.version }, owner),
		).rejects.toThrow("FK failure");
		expect(mocks.items.get(item.id)?.state).toBe("open");
		expect(mocks.revalidate).not.toHaveBeenCalled();
	});
	it("resolves old and new people, places, and entry cache targets", async () => {
		const item = await pr(owner);
		item.changes = [
			{
				...change,
				kind: "place",
				before: { placeId: ID },
				after: { placeId: OTHER },
			},
			{
				...change,
				kind: "parent_child",
				targetId: OTHER,
				before: { parentId: ID, childId: OTHER },
				after: { parentId: OTHER, childId: ID },
			},
			{
				...change,
				kind: "entry",
				targetId: "00000000-0000-4000-8000-000000000003",
				before: null,
				after: { title: "New" },
			},
		];
		mocks.items.set(item.id, item);
		mocks.read.mockImplementation(
			async (_conn, kind, target) =>
				item.changes.find((c) => c.kind === kind && c.targetId === target)
					?.before,
		);
		mocks.query.mockResolvedValue([{ entity_id: OTHER }]);
		await mergeContribution({ id: item.id, version: item.version }, owner);
		expect(mocks.people).toHaveBeenCalledWith(
			expect.arrayContaining([ID, OTHER]),
		);
		expect(mocks.entities).toHaveBeenCalledWith([OTHER]);
		expect(mocks.entries).toHaveBeenCalledWith([item.changes[2].targetId]);
	});
	it("enforces event and optimistic-version bounds", async () => {
		const item = await issue();
		item.events = Array(1000).fill(item.events[0]);
		expect(() => addEvent(item, alice, "comment", "excess")).toThrow("limit");
		expect(() =>
			addEvent(item, owner, "approved", "final review"),
		).not.toThrow();
		for (const version of [NaN, 1.2, "1", undefined])
			expect(() => assertVersion(item, version)).toThrow("Reload");
	});
});
