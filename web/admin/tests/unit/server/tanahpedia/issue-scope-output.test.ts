import { expect, it, vi } from "vitest";
import { CONTRIBUTION_RECORDS } from "~/lib/tanahpedia/contribution-records";
import { SOURCE_TARGETS } from "~/lib/tanahpedia/contribution-specials";
import {
	CONTRIBUTION_ISSUE_SCOPE_KINDS,
	type Contribution,
} from "~/lib/tanahpedia/contributions";

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
} from "~/server/tanahpedia/contribution-agent-output.server";
import {
	contributionOutputSchema,
	type ModelCatalogue,
} from "~/server/tanahpedia/contribution-llm.server";

const id = "00000000-0000-4000-8000-000000000001",
	other = "00000000-0000-4000-8000-000000000002";
const families = new Set([
	...Object.keys(SOURCE_TARGETS),
	"entry",
	"alternative",
	"article",
	"article_author",
	"dedication",
	"moed",
	"perek",
	"perush",
]);
const numeric = new Set([
	"article",
	"article_author",
	"dedication",
	"moed",
	"perek",
	"perush",
]);
for (const spec of Object.values(CONTRIBUTION_RECORDS))
	for (const field of Object.values(spec.fields))
		if (field.reference) {
			families.add(field.reference);
			if (field.numericReference) numeric.add(field.reference);
		}
const catalogue: ModelCatalogue = {
	people: [
		{ id, name: "A" },
		{ id: other, name: "B" },
	],
	places: [{ id, name: "P" }],
	entities: [{ id, name: "E" }],
	references: Object.fromEntries(
		[...families].map((f) => [
			f,
			[{ id: numeric.has(f) ? 1 : id, name: "Reference" }],
		]),
	),
	targets: CONTRIBUTION_ISSUE_SCOPE_KINDS.map((kind) => ({
		kind,
		id: kind === "article_links" ? "27" : id,
	})),
};
function issue(): Contribution {
	return {
		id,
		number: 1,
		kind: "issue",
		state: "open",
		title: "Request",
		description: "No inferred identity",
		assignee: { kind: "local_llm" },
		evidence: [{ citation: "מקור", quote: "", url: null, note: "" }],
		changes: [],
		events: [],
		issueId: null,
		revision: 1,
		version: 1,
		closeIssue: false,
		provenance: null,
	} as unknown as Contribution;
}
it.each(
	CONTRIBUTION_ISSUE_SCOPE_KINDS.filter((kind) => kind !== "place_profile"),
)("narrows the decoder to %s and its exact existing target", (kind) => {
	const targetId = kind === "article_links" ? "27" : id;
	const schema = contributionOutputSchema(catalogue, 1, {
		kind,
		...(kind === "entry" ? {} : { targetId }),
	});
	const variants =
		schema.properties.pullRequests.items.properties.changes.items.oneOf;
	expect(variants.length).toBeGreaterThan(0);
	for (const variant of variants) {
		const p = variant.properties as Record<string, unknown>;
		expect(p.kind).toEqual({ const: kind });
		if (kind === "entry") expect(p.targetId).toBeUndefined();
		else {
			expect(p.targetId).toEqual({ enum: [targetId] });
			expect(variant.required).toContain("targetId");
		}
	}
});
it("keeps clarification available when the scoped target or required references have not been read", () => {
	const current = issue();
	current.scope = { kind: "parent_child", targetId: id };
	const empty = {
		people: [],
		places: [],
		entities: [],
		targets: [],
		references: {},
	};
	const schema = contributionAgentResultSchema(current, empty);
	expect(schema.oneOf.map((b) => b.properties.outcome.const)).toEqual([
		"unchanged",
		"clarification",
	]);
	expect(
		contributionOutputSchema(empty, 1, current.scope).properties.pullRequests
			.items.properties.changes.items.oneOf,
	).toEqual([{ not: {} }]);
	expect(
		parseContributionAgentResult(
			JSON.stringify({
				outcome: "clarification",
				summary: "נדרשים פרטים",
				responses: [],
			}),
			current,
			empty,
		).outcome,
	).toBe("clarification");
});
it("permits new and existing rows of the selected kind when no target was selected", () => {
	const variants = contributionOutputSchema(catalogue, 1, {
		kind: "parent_child",
	}).properties.pullRequests.items.properties.changes.items.oneOf;
	expect(variants).toHaveLength(2);
	expect(
		variants.every(
			(v) =>
				(v.properties as { kind: { const: string } }).kind.const ===
				"parent_child",
		),
	).toBe(true);
	expect(
		variants.some((v) => !(v.required as string[]).includes("targetId")),
	).toBe(true);
	expect(
		variants.some((v) => (v.required as string[]).includes("targetId")),
	).toBe(true);
});
const metadata = {
	kind: "metadata",
	targetId: id,
	after: { displayName: "עדכון" },
};
it.each([undefined, null, {}, "invalid"])(
	"rejects malformed scoped PR collections %j",
	(pullRequests) => {
		const current = issue();
		current.scope = { kind: "metadata", targetId: id };
		expect(() =>
			parseContributionAgentResult(
				JSON.stringify({
					outcome: "implemented",
					summary: "שינוי",
					responses: [],
					pullRequests,
				}),
				current,
				catalogue,
			),
		).toThrow("Agent PRs are required");
	},
);
const entry = {
	kind: "entry",
	after: {
		title: "חדש",
		uniqueName: "חדש",
		entityType: "PERSON",
		displayName: "חדש",
	},
};
it.each([entry, { ...metadata, targetId: other }])(
	"rejects an unrelated issue implementation before persistence %j",
	(change) => {
		const current = issue();
		current.scope = { kind: "metadata", targetId: id };
		expect(() =>
			parseContributionAgentResult(
				JSON.stringify({
					outcome: "implemented",
					summary: "שינוי",
					responses: [],
					pullRequests: [
						{
							title: "PR",
							description: "מבוסס מקור",
							evidenceIndexes: [0],
							changes: [change],
						},
					],
				}),
				current,
				catalogue,
			),
		).toThrow("outside the issue scope");
	},
);
it("allows the scoped implementation and leaves later PR resolution independent", () => {
	const current = issue();
	current.scope = { kind: "metadata", targetId: id };
	expect(
		parseContributionAgentResult(
			JSON.stringify({
				outcome: "implemented",
				summary: "שינוי",
				responses: [],
				pullRequests: [
					{
						title: "PR",
						description: "מבוסס מקור",
						evidenceIndexes: [0],
						changes: [metadata],
					},
				],
			}),
			current,
			catalogue,
		).outcome,
	).toBe("implemented");
	current.kind = "pr";
	current.scope = { kind: "entry" };
	expect(
		parseContributionAgentResult(
			JSON.stringify({
				outcome: "revised",
				summary: "תגובה לבקשת אדם",
				responses: [],
				draft: { changes: [metadata] },
			}),
			current,
			catalogue,
		).draft?.changes,
	).toEqual([metadata]);
});
