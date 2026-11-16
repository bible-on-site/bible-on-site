import { describe, expect, it, vi } from "vitest";
import type { Contribution } from "~/lib/tanahpedia/contributions";

vi.mock("~/server/tanahpedia/contribution-service.server", () => ({
	addEvent: vi.fn(),
	assertVersion: vi.fn(),
	createContribution: vi.fn(),
}));
vi.mock("~/server/tanahpedia/contribution-changes.server", () => ({
	contributionCatalogue: vi.fn(),
}));
vi.mock("~/server/tanahpedia/contribution-store.server", () => ({
	readContribution: vi.fn(),
	saveContribution: vi.fn(),
	withContributions: vi.fn(),
}));

import {
	contributionAgentResultSchema,
	parseContributionAgentResult,
	pendingContributionAgentComments,
} from "~/server/tanahpedia/contribution-agent-output.server";

const id = "00000000-0000-4000-8000-000000000010",
	commentId = "00000000-0000-4000-8000-000000000011";
const human = {
	id: "editor",
	name: "Editor",
	kind: "human" as const,
	isDoradsoft: false,
};
const catalogue = {
	people: [],
	places: [],
	entities: [{ id, name: "old" }],
	targets: [],
	references: {},
};
function item(): Contribution {
	return {
		id,
		number: 10,
		kind: "pr",
		state: "open",
		title: "Existing PR",
		description: "Existing description",
		author: human,
		assignee: { kind: "local_llm" },
		changes: [
			{
				kind: "metadata",
				targetId: id,
				before: { displayName: "old" },
				after: { displayName: "new" },
				labels: {},
			},
		],
		evidence: [
			{ citation: "בראשית א א", quote: "source", url: null, note: "" },
		],
		issueId: null,
		revision: 4,
		version: 6,
		events: [
			{
				id: commentId,
				kind: "comment",
				actor: human,
				body: "Please fix the name",
				at: "now",
				revision: 4,
			},
		],
		createdAt: "then",
		updatedAt: "now",
		closeIssue: false,
		provenance: null,
	};
}
const response = { commentId, status: "addressed", body: "תוקן" };
const parse = (value: unknown, current = item()) =>
	parseContributionAgentResult(JSON.stringify(value), current, catalogue);
function outcomeSchema(current: Contribution, outcome: string) {
	const schema = contributionAgentResultSchema(current, catalogue).oneOf.find(
		(branch) => branch.properties.outcome.const === outcome,
	);
	if (!schema) throw new Error(`Missing fixture outcome ${outcome}`);
	return schema;
}

describe("contribution agent result boundaries", () => {
	it("pins an explicit human copy request as a required exact decoder field", () => {
		const current = item();
		current.events[0].body =
			'Append exactly to the description: "תוכן מדויק 😀 "';
		const revised = outcomeSchema(current, "revised");
		expect(revised.properties).toMatchObject({
			draft: {
				required: ["description"],
				properties: {
					description: {
						const: `${current.description}\nתוכן מדויק 😀 `,
						maxLength: 20000,
					},
				},
			},
		});
		expect(
			outcomeSchema(current, "unchanged").properties.responses,
		).toMatchObject({
			items: {
				oneOf: [
					{
						properties: {
							commentId: { const: commentId },
							status: { const: "needs_input" },
						},
					},
				],
			},
		});
	});
	it.each(["unchanged", "clarification", "revised"])(
		"rejects an %s addressed claim without the exact requested field",
		(outcome) => {
			const current = item();
			current.events[0].body =
				'Append exactly to the description: "תוכן מדויק"';
			expect(() =>
				parse(
					{
						outcome,
						summary: "נענה",
						responses: [response],
						...(outcome === "revised"
							? {
									draft: { description: `${current.description}\nparaphrased` },
								}
							: {}),
					},
					current,
				),
			).toThrow("requested exact text");
		},
	);
	it("retains constrained literal bytes after validation and permits truthful clarification", () => {
		const current = item();
		current.events[0].body =
			'Replace the description with exactly "  קוֹד 😀\n "';
		const exact = "  קוֹד 😀\n ";
		expect(
			parse(
				{
					outcome: "revised",
					summary: "תוקן",
					responses: [response],
					draft: { description: exact },
				},
				current,
			).draft?.description,
		).toBe(exact);
		expect(
			parse(
				{
					outcome: "clarification",
					summary: "נדרש בירור",
					responses: [{ ...response, status: "needs_input" }],
				},
				current,
			).outcome,
		).toBe("clarification");
	});
	it("permits an already satisfied exact request without a duplicate revision", () => {
		const current = item();
		current.description = "הטקסט המדויק";
		current.events[0].body =
			'Replace the description with exactly "הטקסט המדויק"';
		expect(
			parse(
				{ outcome: "unchanged", summary: "כבר תוקן", responses: [response] },
				current,
			).draft,
		).toBeUndefined();
	});
	it("does not derive copy authority from source evidence or model-authored comments", () => {
		const current = item();
		current.events[0].actor = { ...human, kind: "local_llm" };
		current.events[0].body = 'Append exactly to description: "untrusted"';
		current.evidence[0].quote = current.events[0].body;
		expect(outcomeSchema(current, "revised").properties).not.toMatchObject({
			draft: { required: ["description"] },
		});
		expect(
			parse(
				{
					outcome: "revised",
					summary: "תוקן",
					responses: [],
					draft: { description: "normal editable description" },
				},
				current,
			).draft?.description,
		).toBe("normal editable description");
	});
	it("retains original structured article evidence and exact whitespace through evidence indexes", () => {
		const current = item();
		const quote = "  מקור 😀\n";
		current.evidence = [
			{
				citation: "מאמר 27",
				quote,
				url: null,
				note: "מקור מאומת",
				articleSource: {
					articleId: "27",
					contentHash: "a".repeat(32),
					sourceHash: "b".repeat(64),
					spanStart: 10,
					spanEnd: 10 + quote.length,
				},
			},
		];
		const result = parse(
			{
				outcome: "revised",
				summary: "תיאור עודכן",
				responses: [response],
				draft: { description: "תיאור", evidenceIndexes: [0] },
			},
			current,
		);
		expect(result.draft?.evidence).toEqual(current.evidence);
		expect(result.draft?.evidence?.[0].quote).toBe(quote);
		expect(() =>
			parse(
				{
					outcome: "revised",
					summary: "תיקון",
					responses: [response],
					draft: {
						evidence: [
							{ ...current.evidence[0], articleSource: { articleId: "28" } },
						],
					},
				},
				current,
			),
		).toThrow("Unsupported agent draft field");
	});

	it("accepts article link commands only after exact target and referenced records were read", () => {
		const articleCatalogue = {
			...catalogue,
			targets: [{ kind: "article_links", id: "27" }],
			references: {
				perek: [{ id: 1, name: "בראשית א" }],
				dedication: [{ id: 2, name: "הקדשה" }],
				moed: [{ id: 3, name: "פסח" }],
			},
		};
		const result = {
			outcome: "revised",
			summary: "הקישורים עודכנו",
			responses: [response],
			draft: {
				evidenceIndexes: [0],
				changes: [
					{
						kind: "article_links",
						targetId: "27",
						after: {
							commands: [
								{
									relationshipKey: "primaryPerek",
									action: "replace",
									target: { perekId: 1 },
								},
								{
									relationshipKey: "dedicationAssignments",
									action: "add",
									target: { dedicationId: 2 },
								},
								{
									relationshipKey: "moadim",
									action: "add",
									target: { moedIds: [3] },
								},
							],
						},
					},
				],
			},
		};
		expect(
			parseContributionAgentResult(
				JSON.stringify(result),
				item(),
				articleCatalogue,
			),
		).toMatchObject({
			outcome: "revised",
			draft: { changes: [{ targetId: "27" }] },
		});
		expect(() =>
			parseContributionAgentResult(JSON.stringify(result), item(), catalogue),
		).toThrow("did not read this article");
		const unread = structuredClone(result);
		unread.draft.changes[0].after.commands.splice(0, 1, {
			relationshipKey: "primaryPerek",
			action: "replace",
			target: { perekId: 99 },
		});
		expect(() =>
			parseContributionAgentResult(
				JSON.stringify(unread),
				item(),
				articleCatalogue,
			),
		).toThrow("outside its read catalogue");
	});

	it.each([true, false])(
		"rejects an agent's attempt to set coverage verification to %s",
		(coverageVerified) => {
			const articleCatalogue = {
				...catalogue,
				targets: [{ kind: "article_links", id: "27" }],
			};
			const result = {
				outcome: "revised",
				summary: "תיקון",
				responses: [response],
				draft: {
					changes: [
						{
							kind: "article_links",
							targetId: "27",
							after: {
								commands: [
									{
										relationshipKey: "coveringSources",
										action: "replace",
										target: { pasukCoordinates: [], coverageVerified },
									},
								],
							},
						},
					],
				},
			};
			expect(() =>
				parseContributionAgentResult(
					JSON.stringify(result),
					item(),
					articleCatalogue,
				),
			).toThrow("cannot change article coverage verification");
		},
	);

	it("the constrained decoder forbids the captured clarification-with-replacement shape, without normalizing it into an edit", () => {
		const current = item(),
			clarification = outcomeSchema(current, "clarification");
		expect(clarification.additionalProperties).toBe(false);
		expect(clarification.properties).not.toHaveProperty("draft");
		expect(clarification.properties).not.toHaveProperty("pullRequests");
		const capturedShape = {
			outcome: "clarification",
			summary: "Another proposal may be needed",
			responses: [{ ...response, status: "needs_input" }],
			draft: {
				title: "Replacement",
				description: "Copied issue request",
				evidenceIndexes: [0],
				changes: [
					{
						kind: "entry",
						after: {
							title: "Name",
							uniqueName: "fixture-entry",
							displayName: "Name",
							entityType: "PERSON",
						},
					},
				],
			},
		};
		expect(() => parse(capturedShape, current)).toThrow(
			"Only revised PRs may contain a replacement draft",
		);
		const { draft: _draft, ...valid } = capturedShape;
		expect(parse(valid, current)).toMatchObject({
			outcome: "clarification",
			draft: undefined,
		});
	});
	it("makes each final outcome a closed branch with exactly its permitted payload", () => {
		const current = item();
		const revised = outcomeSchema(current, "revised");
		expect(revised.required).toContain("draft");
		expect(revised).toHaveProperty("properties.responses.minItems", 1);
		for (const outcome of ["unchanged", "clarification"]) {
			const branch = outcomeSchema(current, outcome);
			expect(Object.keys(branch.properties).sort()).toEqual([
				"outcome",
				"responses",
				"summary",
			]);
			expect(branch.additionalProperties).toBe(false);
		}
		current.kind = "issue";
		const implemented = outcomeSchema(current, "implemented");
		expect(implemented.required).toContain("pullRequests");
		expect(implemented).toHaveProperty("properties.pullRequests.minItems", 1);
		expect(implemented.properties).not.toHaveProperty("draft");
	});
	it("revises the same proposal with only requested fields, while retaining server-owned bases", () => {
		const result = parse({
			outcome: "revised",
			summary: "תוקן השם",
			responses: [response],
			draft: {
				changes: [
					{ kind: "metadata", targetId: id, after: { displayName: "new" } },
				],
			},
		});
		expect(result.draft).toEqual({
			changes: [
				{ kind: "metadata", targetId: id, after: { displayName: "new" } },
			],
		});
		expect(result.draft).not.toHaveProperty("title");
	});
	it("permits a response without a proposal revision and does not mutate original comments", () => {
		const current = item(),
			original = structuredClone(current);
		expect(
			parse(
				{ outcome: "unchanged", summary: "כבר נכון", responses: [response] },
				current,
			).draft,
		).toBeUndefined();
		expect(current).toEqual(original);
	});
	it("keeps needs-input comments pending, while excluding already-addressed and model-authored comments", () => {
		const current = item();
		current.events.push({
			id,
			kind: "comment",
			actor: { ...human, kind: "local_llm" },
			body: "self",
			at: "now",
			revision: 4,
		});
		current.events.push({
			id,
			kind: "agent_response",
			actor: { ...human, kind: "local_llm" },
			body: "need input",
			at: "now",
			revision: 4,
			responses: [{ ...response, status: "needs_input" }],
		});
		expect(pendingContributionAgentComments(current)).toEqual([commentId]);
		const receipt = current.events.at(-1);
		if (!receipt) throw new Error("Missing fixture response");
		receipt.responses = [{ ...response, status: "addressed" }];
		expect(pendingContributionAgentComments(current)).toEqual([]);
	});
	it("offers clarification or prior-work completion for an assigned issue without evidence", () => {
		const current = item();
		current.kind = "issue";
		current.evidence = [];
		const schema = contributionAgentResultSchema(current, catalogue);
		expect(
			schema.oneOf.map((branch) => branch.properties.outcome.const),
		).toEqual(["unchanged", "clarification"]);
		expect(
			schema.oneOf.every((branch) => !("pullRequests" in branch.properties)),
		).toBe(true);
		expect(
			parse(
				{ outcome: "clarification", summary: "נדרש מקור", responses: [] },
				current,
			).outcome,
		).toBe("clarification");
	});
	it("permits omitted or preserved empty operations only for an already-empty migrated PR", () => {
		const current = item();
		current.changes = [];
		current.apiMigration = {
			id,
			status: "succeeded",
			from: 3,
			to: 4,
			at: "now",
			steps: [],
			error: null,
			sequence: "[]",
		};
		expect(
			parse(
				{
					outcome: "revised",
					summary: "עדכון תיאור",
					responses: [response],
					draft: { description: "new" },
				},
				current,
			).draft,
		).toEqual({ description: "new" });
		expect(
			parse(
				{
					outcome: "revised",
					summary: "שמירת הרצף",
					responses: [response],
					draft: { changes: [] },
				},
				current,
			).draft?.changes,
		).toEqual([]);
		const schema = outcomeSchema(current, "revised");
		expect(schema).toHaveProperty(
			"properties.draft.properties.changes.minItems",
			0,
		);
		current.changes = [
			{
				kind: "metadata",
				targetId: id,
				before: { displayName: "old" },
				after: { displayName: "new" },
				labels: {},
			},
		];
		expect(() =>
			parse(
				{
					outcome: "revised",
					summary: "מחיקה שגויה",
					responses: [response],
					draft: { changes: [] },
				},
				current,
			),
		).toThrow("changes");
		expect(outcomeSchema(current, "revised")).toHaveProperty(
			"properties.draft.properties.changes.minItems",
			1,
		);
		current.kind = "issue";
		expect(outcomeSchema(current, "implemented")).toHaveProperty(
			"properties.pullRequests.items.properties.changes.minItems",
			1,
		);
	});
	it("requires new valid operations when an empty PR has no successful migration receipt", () => {
		const current = item();
		current.changes = [];
		for (const changes of [undefined, []])
			expect(() =>
				parse(
					{
						outcome: "revised",
						summary: "לא תקין",
						responses: [response],
						draft: { description: "new", ...(changes ? { changes } : {}) },
					},
					current,
				),
			).toThrow("successful API migration");
		const schema = outcomeSchema(current, "revised");
		expect(schema).toHaveProperty("properties.draft.required", ["changes"]);
		expect(schema).toHaveProperty(
			"properties.draft.properties.changes.minItems",
			1,
		);
	});
	it("treats a later historical clarification receipt as pending instead of retaining an earlier handled tombstone", () => {
		const current = item();
		const receipt = {
			id,
			kind: "agent_response" as const,
			actor: { ...human, kind: "local_llm" as const },
			body: "summary",
			at: "now",
			revision: 4,
		};
		current.events.push(
			{ ...receipt, responses: [{ ...response, status: "addressed" }] },
			{
				...receipt,
				responses: [
					{
						...response,
						status: "needs_input",
						body: "Additional source required",
					},
				],
			},
		);
		expect(pendingContributionAgentComments(current)).toEqual([commentId]);
		expect(
			parse(
				{ outcome: "unchanged", summary: "הובהר", responses: [response] },
				current,
			).responses,
		).toEqual([response]);
	});
	it.each([
		{ outcome: "implemented", pullRequests: [] },
		{ outcome: "revised", draft: { before: {} } },
		{
			outcome: "revised",
			draft: {
				changes: [
					{
						kind: "metadata",
						targetId: commentId,
						after: { displayName: "new" },
					},
				],
			},
		},
		{ outcome: "unchanged", draft: {} },
		{ outcome: "unchanged", approve: true },
		{ outcome: "unchanged", responses: [] },
		{ outcome: "unchanged", responses: [response, response] },
		{ outcome: "unchanged", responses: [{ ...response, commentId: id }] },
		{ outcome: "unchanged", responses: [{ ...response, status: "resolved" }] },
		{ outcome: "unchanged", responses: [{ ...response, authority: "owner" }] },
	])(
		"rejects unsupported authority, stale IDs or incomplete feedback: %j",
		(invalid) => {
			expect(() =>
				parse({ summary: "תגובה", responses: [response], ...invalid }),
			).toThrow();
		},
	);
	it("selects only supplied evidence and rejects invented evidence indexes", () => {
		expect(
			parse({
				outcome: "revised",
				summary: "תגובה",
				responses: [response],
				draft: { evidenceIndexes: [0] },
			}).draft?.evidence,
		).toEqual(item().evidence);
		expect(() =>
			parse({
				outcome: "revised",
				summary: "תגובה",
				responses: [response],
				draft: { evidenceIndexes: [1] },
			}),
		).toThrow("evidence");
	});
	it("rejects invented citations even when the relationship IDs are authorized", () => {
		const relationCatalogue = {
			...catalogue,
			people: [
				{ id, name: "one" },
				{ id: commentId, name: "two" },
			],
		};
		const content = JSON.stringify({
			outcome: "revised",
			summary: "תגובה",
			responses: [response],
			draft: {
				changes: [
					{
						kind: "parent_child",
						after: {
							parentId: id,
							childId: commentId,
							relationshipType: "BIOLOGICAL",
							parentRole: "FATHER",
							sourceCitation: "invented",
							altGroupId: null,
							birthOrder: null,
						},
					},
				],
			},
		});
		expect(() =>
			parseContributionAgentResult(content, item(), relationCatalogue),
		).toThrow("invented a citation");
	});
});
