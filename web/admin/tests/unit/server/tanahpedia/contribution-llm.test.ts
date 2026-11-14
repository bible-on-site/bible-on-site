import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangeInput, Contribution } from "~/lib/tanahpedia/contributions";

const mocks = vi.hoisted(() => ({
	read: vi.fn(),
	catalogue: vi.fn(),
	create: vi.fn(),
	save: vi.fn(),
	event: vi.fn(),
	send: vi.fn(),
	destroy: vi.fn(),
	fetch: vi.fn(),
}));
vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
	BedrockRuntimeClient: class {
		send = mocks.send;
		destroy = mocks.destroy;
	},
	ConverseCommand: class {
		constructor(public input: unknown) {}
	},
}));
vi.mock("~/server/tanahpedia/contribution-store.server", () => ({
	readContribution: mocks.read,
	saveContribution: mocks.save,
	withContributions: async (fn: (conn: object) => unknown) => fn({}),
}));
vi.mock("~/server/tanahpedia/contribution-changes.server", () => ({
	contributionCatalogue: mocks.catalogue,
}));
vi.mock("~/server/tanahpedia/contribution-service.server", () => ({
	addEvent: mocks.event,
	assertVersion: (item: Contribution, version: number) => {
		if (item.version !== version) throw new Error("Reload");
	},
	createContribution: mocks.create,
}));

import {
	assertGeneratedReferences,
	contributionLlmStatus,
	contributionOutputSchema,
	contributionSystemPrompt,
	generateContributionPrs,
} from "~/server/tanahpedia/contribution-llm.server";

const ID = "00000000-0000-4000-8000-000000000001";
const draft = {
	title: "הצעה",
	description: "מקור תומך",
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
};
const input = { id: ID, version: 1 };
let issue: Contribution;
function localOutput(output: unknown) {
	mocks.fetch.mockResolvedValue({
		ok: true,
		json: async () => ({
			model: "local-actual",
			message: {
				content: typeof output === "string" ? output : JSON.stringify(output),
			},
		}),
	});
}

describe("issue-to-PR LLM generation", () => {
	it("constrains generated IDs to the supplied catalogue for both providers", () => {
		const catalogue = {
			people: [
				{ id: ID, name: "אדם" },
				{ id: "00000000-0000-4000-8000-000000000002", name: "שת" },
			],
			places: [{ id: ID, name: "מקום" }],
			entities: [{ id: ID, name: "אדם" }],
			targets: [
				{ id: ID, kind: "parent_child" },
				{ id: ID, kind: "union" },
				{ id: ID, kind: "place" },
			],
		};
		const schema = contributionOutputSchema(catalogue, 1);
		expect(JSON.stringify(schema)).toContain('"maximum":0');
		expect(JSON.stringify(schema)).toContain('"const":"parent_child"');
		expect(JSON.stringify(schema)).toContain('"const":"metadata"');
		expect(
			JSON.stringify(
				contributionOutputSchema(
					{ people: [], places: [], entities: [], targets: [] },
					1,
				),
			),
		).not.toContain('"const":"parent_child"');
		expect(() =>
			assertGeneratedReferences(
				[{ kind: "metadata", targetId: ID, after: { displayName: "Name" } }],
				catalogue,
			),
		).not.toThrow();
		expect(() =>
			assertGeneratedReferences(
				[
					{
						kind: "metadata",
						targetId: "not-supplied",
						after: { displayName: "Name" },
					},
				],
				catalogue,
			),
		).toThrow("not supplied");
		expect(() =>
			assertGeneratedReferences(
				[
					{
						kind: "place",
						after: {
							placeId: "not-supplied",
							modernName: null,
							latitude: null,
							longitude: null,
							altGroupId: null,
						},
					},
				],
				catalogue,
			),
		).toThrow("place");
		expect(() =>
			assertGeneratedReferences(
				[{ kind: "parent_child", targetId: ID, after: null }],
				catalogue,
			),
		).not.toThrow();
		const invalidReferences: ChangeInput[] = [
			{
				kind: "parent_child",
				after: {
					parentId: ID,
					childId: "not-supplied",
					relationshipType: "BIOLOGICAL",
					parentRole: "FATHER",
					sourceCitation: null,
					altGroupId: null,
					birthOrder: null,
				},
			},
			{
				kind: "union",
				after: {
					person1Id: ID,
					person2Id: "not-supplied",
					unionType: "MARRIAGE",
					unionOrder: null,
					startDate: null,
					endDate: null,
					endReason: null,
					sourceCitation: null,
					personSourceCitation: null,
					altGroupId: null,
				},
			},
		];
		for (const change of invalidReferences)
			expect(() => assertGeneratedReferences([change], catalogue)).toThrow(
				"person",
			);
	});
	it("rejects invented citations even when the operation IDs are real", async () => {
		mocks.catalogue.mockResolvedValue({
			people: [],
			places: [],
			entities: [],
			targets: [
				{ id: ID, kind: "parent_child", after: { parentId: "not-in-context" } },
			],
		});
		localOutput({
			pullRequests: [
				{
					...draft,
					changes: [{ kind: "parent_child", targetId: ID, after: null }],
				},
			],
		});
		// No target is supplied to the model unless a named issue reference selects it.
		await expect(generateContributionPrs(input)).rejects.toThrow(
			"not supplied",
		);
		mocks.catalogue.mockResolvedValue({
			people: [
				{ id: ID, name: "אדם" },
				{ id: "00000000-0000-4000-8000-000000000002", name: "שת" },
			],
			places: [],
			entities: [],
			targets: [],
		});
		issue.description = "אדם שת";
		localOutput({
			pullRequests: [
				{
					...draft,
					changes: [
						{
							kind: "parent_child",
							after: {
								parentId: ID,
								childId: "00000000-0000-4000-8000-000000000002",
								relationshipType: "BIOLOGICAL",
								parentRole: "FATHER",
								sourceCitation: "מקור שהמודל המציא",
							},
						},
					],
				},
			],
		});
		await expect(generateContributionPrs(input)).rejects.toThrow(
			"invented a citation",
		);
		expect(mocks.create).not.toHaveBeenCalled();
	});
	it("does not match a short name inside an unrelated longer name", async () => {
		issue.description = "נחור";
		mocks.catalogue.mockResolvedValue({
			people: [
				{ id: ID, name: "נח" },
				{ id: "00000000-0000-4000-8000-000000000002", name: "נחור" },
			],
			places: [],
			entities: [],
			targets: [],
		});
		await generateContributionPrs(input);
		const context = JSON.parse(
			JSON.parse(mocks.fetch.mock.calls[0][1].body).messages[1].content,
		);
		expect(
			context.catalogue.people.map((person: { name: string }) => person.name),
		).toEqual(["נחור"]);
	});
	beforeEach(() => {
		vi.stubEnv("LOCAL_LLM_MODEL", "local-test");
		vi.stubEnv("LOCAL_LLM_URL", "");
		vi.stubEnv("BEDROCK_MODEL_ID", "aws-test");
		vi.stubEnv("BEDROCK_REGION", "us-east-1");
		vi.stubGlobal("fetch", mocks.fetch);
		for (const mock of Object.values(mocks)) mock.mockReset();
		issue = {
			id: ID,
			number: 1,
			kind: "issue",
			state: "open",
			title: "חדש",
			description: "בקשה מבוססת מקור",
			assignee: { kind: "local_llm" },
			evidence: [{ citation: "מקור", quote: "המקור", url: null, note: "" }],
			version: 1,
			revision: 1,
			events: [],
		} as unknown as Contribution;
		mocks.read.mockImplementation(async () => structuredClone(issue));
		mocks.catalogue.mockResolvedValue({
			people: [],
			places: [],
			entities: [],
			targets: [],
		});
		mocks.create.mockImplementation(async (_draft, _actor, provenance) => ({
			id: crypto.randomUUID(),
			number: 2,
			provenance,
		}));
		localOutput({ pullRequests: [draft] });
		mocks.send.mockResolvedValue({
			output: {
				message: {
					content: [{ text: JSON.stringify({ pullRequests: [draft] }) }],
				},
			},
		});
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	});
	it("reports explicit provider configuration without exposing credentials", () => {
		expect(contributionLlmStatus()).toEqual({
			local: { enabled: true, model: "local-test" },
			aws: { enabled: true, model: "aws-test" },
		});
		vi.stubEnv("LOCAL_LLM_MODEL", "");
		vi.stubEnv("BEDROCK_MODEL_ID", "");
		expect(contributionLlmStatus()).toMatchObject({
			local: { enabled: false },
			aws: { enabled: false },
		});
	});
	it("creates a model-authored local PR with inherited evidence and no review authority", async () => {
		const result = await generateContributionPrs(input);
		expect(result).toHaveLength(1);
		expect(mocks.create).toHaveBeenCalledWith(
			expect.objectContaining({ issueId: ID, evidence: issue.evidence }),
			expect.objectContaining({
				kind: "local_llm",
				isDoradsoft: false,
				name: "local-actual",
			}),
			expect.objectContaining({ provider: "local_llm", model: "local-actual" }),
			expect.anything(),
		);
		expect(mocks.save).toHaveBeenCalled();
		expect(mocks.event).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			"generated",
			"PR #2",
		);
		const [url, request] = mocks.fetch.mock.calls[0];
		expect(String(url)).toBe("http://127.0.0.1:11434/api/chat");
		expect(JSON.parse(request.body)).toMatchObject({
			model: "local-test",
			stream: false,
			options: { temperature: 0 },
		});
		expect(request.headers.Authorization).toBeUndefined();
	});
	it("separates multiple PR types without automatically resolving the source issue", async () => {
		localOutput({ pullRequests: [draft, { ...draft, title: "הצעה אחרת" }] });
		expect(await generateContributionPrs(input)).toHaveLength(2);
		expect(mocks.create.mock.calls[0][0].closeIssue).toBe(false);
	});
	it("calls AWS Bedrock only for the AWS assignee and destroys the client", async () => {
		issue.assignee = { kind: "aws_llm" };
		await generateContributionPrs(input);
		expect(mocks.fetch).not.toHaveBeenCalled();
		expect(mocks.send.mock.calls[0][0].input).toMatchObject({
			modelId: "aws-test",
			inferenceConfig: { temperature: 0 },
			system: [{ text: contributionSystemPrompt() }],
		});
		expect(mocks.create.mock.calls[0][1]).toMatchObject({
			kind: "aws_llm",
			isDoradsoft: false,
		});
		expect(mocks.destroy).toHaveBeenCalledOnce();
	});
	it("cleans up AWS clients on inference failures", async () => {
		issue.assignee = { kind: "aws_llm" };
		mocks.send.mockRejectedValue(new Error("Bedrock unavailable"));
		await expect(generateContributionPrs(input)).rejects.toThrow("unavailable");
		expect(mocks.destroy).toHaveBeenCalledOnce();
		expect(mocks.create).not.toHaveBeenCalled();
	});
	it("fails clearly when the selected provider is unconfigured", async () => {
		vi.stubEnv("LOCAL_LLM_MODEL", "");
		await expect(generateContributionPrs(input)).rejects.toThrow(
			"LOCAL_LLM_MODEL",
		);
		issue.assignee = { kind: "aws_llm" };
		vi.stubEnv("BEDROCK_MODEL_ID", "");
		await expect(generateContributionPrs(input)).rejects.toThrow(
			"BEDROCK_MODEL_ID",
		);
	});
	it.each([
		{ kind: "unassigned" },
		{ kind: "human", id: "alice", name: "Alice" },
	])("does not execute for %j assignment", async (assignee) => {
		issue.assignee = assignee as Contribution["assignee"];
		await expect(generateContributionPrs(input)).rejects.toThrow("Assign");
		expect(mocks.fetch).not.toHaveBeenCalled();
	});
	it("requires an open issue with evidence", async () => {
		issue.state = "closed";
		await expect(generateContributionPrs(input)).rejects.toThrow("open issue");
		issue.state = "open";
		issue.kind = "pr";
		await expect(generateContributionPrs(input)).rejects.toThrow("open issue");
		issue.kind = "issue";
		issue.evidence = [];
		await expect(generateContributionPrs(input)).rejects.toThrow("evidence");
	});
	it("rejects stale source versions before and after inference", async () => {
		await expect(
			generateContributionPrs({ ...input, version: 2 }),
		).rejects.toThrow("Reload");
		mocks.read
			.mockResolvedValueOnce(structuredClone(issue))
			.mockResolvedValueOnce({ ...issue, version: 2 });
		await expect(generateContributionPrs(input)).rejects.toThrow("Reload");
		expect(mocks.create).not.toHaveBeenCalled();
	});
	it.each(["not JSON", "```json\n{}\n```", null, []])(
		"rejects invalid model JSON %j",
		async (output) => {
			localOutput(output);
			await expect(generateContributionPrs(input)).rejects.toThrow(
				"invalid JSON",
			);
			expect(mocks.create).not.toHaveBeenCalled();
		},
	);
	it.each([{}, { pullRequests: [] }, { pullRequests: Array(6).fill(draft) }])(
		"rejects invalid batch structure %j",
		async (output) => {
			localOutput(output);
			await expect(generateContributionPrs(input)).rejects.toThrow("1-5");
			expect(mocks.create).not.toHaveBeenCalled();
		},
	);
	it.each([
		{ evidenceIndexes: [] },
		{ evidenceIndexes: [-1] },
		{ evidenceIndexes: [1] },
		{ evidenceIndexes: ["0"] },
		{ evidenceIndexes: [0.5] },
	])(
		"rejects nonexistent evidence references %j",
		async ({ evidenceIndexes }) => {
			localOutput({ pullRequests: [{ ...draft, evidenceIndexes }] });
			await expect(generateContributionPrs(input)).rejects.toThrow("evidence");
			expect(mocks.create).not.toHaveBeenCalled();
		},
	);
	it("rejects model-authored prose and validates every draft before persistence", async () => {
		localOutput({
			pullRequests: [
				draft,
				{
					...draft,
					changes: [
						{
							kind: "entry",
							after: { ...draft.changes[0].after, content: "invented prose" },
						},
					],
				},
			],
		});
		await expect(generateContributionPrs(input)).rejects.toThrow("Unsupported");
		expect(mocks.create).not.toHaveBeenCalled();
	});
	it("does not approve a model output that contains forged authority", async () => {
		localOutput({
			pullRequests: [{ ...draft, author: "doradsoft", approved: true }],
		});
		await generateContributionPrs(input);
		expect(mocks.create.mock.calls[0][1].isDoradsoft).toBe(false);
		expect(mocks.create.mock.calls[0][0].approved).toBeUndefined();
	});
	it("propagates local HTTP failures without saving proposals", async () => {
		mocks.fetch.mockResolvedValue({ ok: false, status: 503 });
		await expect(generateContributionPrs(input)).rejects.toThrow("HTTP 503");
		expect(mocks.create).not.toHaveBeenCalled();
	});
	it("rejects unsafe local endpoint protocols", async () => {
		vi.stubEnv("LOCAL_LLM_URL", "file:///private");
		await expect(generateContributionPrs(input)).rejects.toThrow(
			"Invalid local model URL",
		);
	});
	it("rejects missing provider content", async () => {
		mocks.fetch.mockResolvedValue({
			ok: true,
			json: async () => ({ message: {} }),
		});
		await expect(generateContributionPrs(input)).rejects.toThrow(
			"model output",
		);
		issue.assignee = { kind: "aws_llm" };
		mocks.send.mockResolvedValue({});
		await expect(generateContributionPrs(input)).rejects.toThrow(
			"model output",
		);
	});
	it("includes matching candidates and related row IDs without picking among duplicate names", async () => {
		issue.description = "אדם";
		mocks.catalogue.mockResolvedValue({
			people: [
				{ id: ID, name: "אדם" },
				{ id: "other", name: "אדם" },
				{ id: "unrelated", name: "יעקב" },
			],
			places: [{ id: "place", name: "אדם" }],
			entities: [{ id: "entity", name: "אדם" }],
			targets: [{ id: "edge", after: { parentId: ID } }],
		});
		await generateContributionPrs(input);
		const user = JSON.parse(
			JSON.parse(mocks.fetch.mock.calls[0][1].body).messages[1].content,
		);
		expect(user.catalogue.people).toHaveLength(2);
		expect(user.catalogue.targets[0].id).toBe("edge");
		expect(contributionSystemPrompt()).toContain("untrusted data");
	});
});
