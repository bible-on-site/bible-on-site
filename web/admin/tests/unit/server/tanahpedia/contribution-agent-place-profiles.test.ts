import { expect, it, vi } from "vitest";
import { canonicalJson } from "~/lib/canonical-json";
import {
	type Contribution,
	validateChanges,
} from "~/lib/tanahpedia/contributions";
import { parseContributionAgentResult } from "~/server/tanahpedia/contribution-agent-output.server";
import {
	assertAgentPlaceEvidence,
	assertAgentPlaceReferences,
	materializeAgentPlaceChanges,
} from "~/server/tanahpedia/contribution-agent-place-profiles.server";
import {
	contributionOutputSchema,
	createGeneratedContributionPrs,
	type ModelCatalogue,
} from "~/server/tanahpedia/contribution-llm.server";

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

const id = "00000000-0000-4000-8000-000000000001";
const first = {
	perekId: 51,
	pasukNumber: 1,
	segmentStart: 5,
	segmentEnd: 5,
	text: "מִצְרָ֑יְמָה",
};
const second = { ...first, perekId: 89, pasukNumber: 8 };
const third = { ...first, perekId: 197, pasukNumber: 3 };
const spellings = ["מצרים", "מצרימה"];
const pages = [
	{ spellings, cursor: 0, total: 4, items: [first, second] },
	{ spellings, cursor: 3, total: 4, items: [third] },
];
const catalogue: ModelCatalogue = {
	people: [],
	places: [{ id, name: "מצרים" }],
	entities: [],
	targets: [],
	scriptureOccurrencePages: pages,
};
const evidence = ["זיהוי היסטורי", "מיקום מודרני"].map((citation) => ({
	citation,
	quote: "",
	url: null,
	note: "",
}));
const issue = {
	id,
	kind: "issue",
	scope: { kind: "place_profile" },
	changes: [],
	evidence,
	events: [],
} as unknown as Contribution;
const entry = { title: "מצרים", uniqueName: "מצרים", displayName: "מצרים" };
const change = {
	kind: "place_profile",
	after: { entry, occurrences: [first], identification: null },
};
const choose = (
	selected: { from: number; to: number }[],
	variants = spellings,
	options: { book?: string; includeExisting?: boolean } = {},
) => [
	{
		...change,
		after: {
			...change.after,
			occurrences: { spellings: variants, selected, ...options },
		},
	},
];
const proposal = (changes: unknown, evidenceIndexes = [0, 1]) => ({
	title: "מצרים",
	description: "אזכורי מקום",
	evidenceIndexes,
	changes,
});

const placePr = (occurrences = [first]): Contribution => ({
	...issue,
	kind: "pr",
	scope: undefined,
	changes: [
		{
			kind: "place_profile",
			targetId: id,
			before: null,
			after: {
				...change.after,
				occurrences: occurrences.map((word) => ({ ...word })),
			},
			labels: {},
		},
	],
});

it("appends read ordinal ranges to the same place PR without copying saved spans or duplicates", () => {
	const pr = placePr([first, third]);
	const selection = choose([{ from: 0, to: 1 }], spellings, {
		includeExisting: true,
	});
	const result = parseContributionAgentResult(
		canonicalJson({
			outcome: "revised",
			summary: "הוספת אזכורים",
			responses: [],
			draft: {
				changes: [{ ...selection[0], targetId: id }],
			},
		}),
		pr,
		catalogue,
	);
	expect(result.draft?.changes).toEqual([
		{
			...change,
			targetId: id,
			after: { ...change.after, occurrences: [first, third, second] },
		},
	]);
	const noAppend = choose([{ from: 1, to: 1 }], spellings, {
		includeExisting: false,
	});
	expect(
		materializeAgentPlaceChanges(
			[{ ...noAppend[0], targetId: id }],
			pr,
			catalogue,
		),
	).toEqual([
		{
			...change,
			targetId: id,
			after: { ...change.after, occurrences: [second] },
		},
	]);
});

it("refuses to append to a new proposal or to append unread, conflicting, or over-limit spans", () => {
	const append = (from: number, to = from) =>
		choose([{ from, to }], spellings, { includeExisting: true })[0];
	const pr = placePr();
	expect(() =>
		materializeAgentPlaceChanges([append(0)], issue, catalogue),
	).toThrow(/same place PR/);
	expect(() =>
		materializeAgentPlaceChanges(
			[{ ...append(2), targetId: id }],
			pr,
			catalogue,
		),
	).toThrow(/previously read/);
	const emptySelection = choose([], spellings, { includeExisting: true })[0];
	expect(() =>
		materializeAgentPlaceChanges(
			[{ ...emptySelection, targetId: id }],
			pr,
			catalogue,
		),
	).toThrow(/ranges that were read/);
	const stale = placePr([{ ...first, text: "מִצְרַיִם" }]);
	expect(() =>
		materializeAgentPlaceChanges(
			[{ ...append(0), targetId: id }],
			stale,
			catalogue,
		),
	).toThrow(/disagrees with the existing word span/);
	const proposed = append(1);
	const rename = {
		...proposed,
		targetId: id,
		after: {
			...proposed.after,
			entry: { ...entry, uniqueName: "כנען" },
		},
	};
	expect(() => materializeAgentPlaceChanges([rename], pr, catalogue)).toThrow(
		/place entry identity/,
	);
	const full = placePr(
		Array.from({ length: 1600 }, (_, i) => ({ ...first, perekId: 500 + i })),
	);
	expect(() =>
		materializeAgentPlaceChanges(
			[{ ...append(1), targetId: id }],
			full,
			catalogue,
		),
	).toThrow(/1600/);
});

it("binds ordinals to the exact book filter and grounds explicit words from the same returned page", () => {
	const filtered = {
		...catalogue,
		scriptureOccurrencePages: [
			{ ...pages[0], total: 1, items: [second], book: "שמות" },
		],
	};
	const replacement = choose([{ from: 0, to: 0 }], spellings, { book: "שמות" });
	expect(materializeAgentPlaceChanges(replacement, issue, filtered)).toEqual([
		{ ...change, after: { ...change.after, occurrences: [second] } },
	]);
	expect(() =>
		materializeAgentPlaceChanges(replacement, issue, catalogue),
	).toThrow(/previously read/);
	expect(() =>
		materializeAgentPlaceChanges(choose([{ from: 0, to: 0 }]), issue, filtered),
	).toThrow(/previously read/);
	const input = validateChanges([
		{ ...change, after: { ...change.after, occurrences: [second] } },
	])[0];
	if (input.kind !== "place_profile") throw new Error("Expected place profile");
	expect(() => assertAgentPlaceReferences(input, filtered, [])).not.toThrow();
});

it("limits agent place operations to the explicit scope and one place per PR", () => {
	const changes = contributionOutputSchema(catalogue, 2, issue.scope).properties
		.pullRequests.items.properties.changes;
	expect(changes.maxItems).toBe(1);
	expect(changes.items.oneOf.map((schema) => schema.properties)).toEqual([
		expect.objectContaining({ kind: { const: "place_profile" } }),
		expect.objectContaining({ targetId: { enum: [id] } }),
	]);
	const ordinary = contributionOutputSchema(catalogue, 2);
	expect(JSON.stringify(ordinary)).not.toContain('"const":"place_profile"');
	expect(() =>
		materializeAgentPlaceChanges(
			[change],
			{ ...issue, scope: undefined },
			catalogue,
		),
	).toThrow(/one place per PR/);
	expect(() =>
		materializeAgentPlaceChanges([change, change], issue, catalogue),
	).toThrow(/one place per PR/);
});

it("expands only explicitly selected ordinals from replayed pages", () => {
	const response = parseContributionAgentResult(
		JSON.stringify({
			outcome: "implemented",
			summary: "שלושה אזכורים",
			responses: [],
			pullRequests: [
				proposal(
					choose([
						{ from: 0, to: 1 },
						{ from: 3, to: 3 },
					]),
				),
			],
		}),
		issue,
		catalogue,
	);
	expect(response.pullRequests).toEqual([
		proposal([
			{
				...change,
				after: { ...change.after, occurrences: [first, second, third] },
			},
		]),
	]);
});

it("rejects missing pages, mismatched searches, duplicate selections and inconsistent pages", () => {
	expect(() =>
		materializeAgentPlaceChanges(
			choose([{ from: 0, to: 3 }]),
			issue,
			catalogue,
		),
	).toThrow(/previously read/);
	expect(() =>
		materializeAgentPlaceChanges(
			choose([{ from: 0, to: 0 }], ["ירושלים"]),
			issue,
			catalogue,
		),
	).toThrow(/previously read/);
	expect(() =>
		materializeAgentPlaceChanges(
			choose([
				{ from: 0, to: 1 },
				{ from: 1, to: 1 },
			]),
			issue,
			catalogue,
		),
	).toThrow(/only once/);
	expect(() =>
		materializeAgentPlaceChanges(
			choose([{ from: 0, to: 1600 }]),
			issue,
			catalogue,
		),
	).toThrow(/Invalid Scripture candidate range/);
	expect(() =>
		materializeAgentPlaceChanges(choose([{ from: 0, to: 0 }]), issue, {
			...catalogue,
			scriptureOccurrencePages: [pages[0], { ...pages[1], total: 5 }],
		}),
	).toThrow(/size/);
	expect(() =>
		materializeAgentPlaceChanges(choose([{ from: 0, to: 0 }]), issue, {
			...catalogue,
			scriptureOccurrencePages: [
				pages[0],
				{ ...pages[0], items: [second, first] },
			],
		}),
	).toThrow(/same candidate/);
});

it("rejects an unobserved target or text and respects the same PR's prior anchors", () => {
	const profile = validateChanges([change])[0];
	if (profile.kind !== "place_profile")
		throw new Error("Expected place profile");
	expect(() =>
		assertAgentPlaceReferences(profile, catalogue, []),
	).not.toThrow();
	expect(() =>
		assertAgentPlaceReferences(
			{ ...profile, targetId: "unknown" },
			catalogue,
			[],
		),
	).toThrow(/place it did not read/);
	expect(() =>
		assertAgentPlaceReferences(
			{
				...profile,
				after: {
					...profile.after,
					occurrences: [{ ...first, text: "משה" }],
				},
			},
			catalogue,
			[],
		),
	).toThrow(/occurrence it did not read/);
	const reviewed = {
		kind: profile.kind,
		targetId: id,
		before: null,
		after: change.after,
		labels: {},
	};
	const pr = {
		...issue,
		kind: "pr" as const,
		scope: undefined,
		changes: [reviewed],
	};
	expect(() =>
		assertAgentPlaceReferences(
			{ ...profile, targetId: id },
			{ ...catalogue, scriptureOccurrencePages: [] },
			pr.changes,
		),
	).not.toThrow();
	expect(() => materializeAgentPlaceChanges([change], pr, catalogue)).toThrow(
		/preserve its place identity/,
	);
});

it("requires selected sources for both the historical identification and the coordinates", () => {
	const coordinateChange = {
		...change,
		after: {
			...change.after,
			identification: {
				modernName: "מצרים",
				latitude: 30,
				longitude: 31,
				basis: "consensus",
				citation: evidence[0].citation,
				coordinateCitation: evidence[1].citation,
			},
		},
	};
	expect(() =>
		assertAgentPlaceEvidence(validateChanges([coordinateChange]), evidence),
	).not.toThrow();
	expect(() =>
		assertAgentPlaceEvidence(
			validateChanges([coordinateChange]),
			evidence.slice(0, 1),
		),
	).toThrow(/both the place identification and its coordinates/);
});

it("rejects duplicate place drafts before persistence", async () => {
	const draft = proposal([change]);
	await expect(
		createGeneratedContributionPrs(
			{ issue, provider: "local_llm", modelCatalogue: catalogue },
			{
				content: JSON.stringify({ pullRequests: [draft, draft] }),
				model: "local-test",
			},
		),
	).rejects.toThrow(/at most one PR for each place/);
});
