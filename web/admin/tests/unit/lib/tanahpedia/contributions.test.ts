import { describe, expect, it } from "vitest";
import {
	assertMergeAllowed,
	assigneeLabel,
	type Contribution,
	type Contributor,
	changedFields,
	contributionCitation,
	record,
	reviewStatus,
	sameState,
	textField,
	uuidField,
	validateAssignee,
	validateChange,
	validateChanges,
	validateEvidence,
} from "~/lib/tanahpedia/contributions";

const ID = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
it.each([
	["יהושע י׳, א׳", "יהושע י א"],
	["יהושע כ״ג, א׳", "יהושע כג א"],
	["שמואל ב׳ ה׳:ו׳", "שמואל ב ה ו"],
	["בראשית ל׳, ו׳–ח׳", "בראשית ל ו-ח"],
	['רש"י, פירוש על התורה', 'רש"י, פירוש על התורה'],
	["וַיְהִי־כֵן", "וַיְהִי־כֵן"],
])(
	"formats a displayed citation without changing arbitrary sources: %s",
	(raw, expected) => expect(contributionCitation(raw)).toBe(expected),
);
const human: Contributor = {
	id: "alice",
	name: "Alice",
	kind: "human",
	isDoradsoft: false,
};
const doradsoft: Contributor = {
	id: "owner",
	name: "doradsoft",
	kind: "human",
	isDoradsoft: true,
};
const parent = {
	kind: "parent_child",
	after: {
		parentId: ID,
		childId: OTHER,
		relationshipType: "BIOLOGICAL",
		parentRole: "FATHER",
	},
};
function pr(): Contribution {
	return {
		id: ID,
		number: 1,
		kind: "pr",
		state: "open",
		title: "Test",
		description: "Description",
		author: human,
		assignee: { kind: "unassigned" },
		evidence: [{ citation: "בראשית א א", quote: "", url: null, note: "" }],
		changes: [
			{
				kind: "metadata",
				targetId: ID,
				before: { displayName: "old" },
				after: { displayName: "new" },
				labels: {},
			},
		],
		issueId: null,
		revision: 1,
		version: 1,
		events: [],
		createdAt: "",
		updatedAt: "",
		closeIssue: true,
		provenance: null,
	};
}

describe("contribution input validation", () => {
	it.each([null, [], "text", 12, false])(
		"rejects non-object input %j",
		(value) => expect(() => record(value)).toThrow(),
	);
	it("trims text and enforces limits", () => {
		expect(textField("  name  ", "name")).toBe("name");
		expect(() => textField("   ", "name")).toThrow();
		expect(() => textField("long", "name", 3)).toThrow();
	});
	it("requires canonical UUIDs", () => {
		expect(uuidField(ID.toUpperCase(), "id")).toBe(ID);
		expect(() => uuidField("row", "id")).toThrow("UUID");
	});
	it.each(["unassigned", "local_llm", "aws_llm"])(
		"keeps %s as a distinct assignee",
		(kind) => {
			expect(validateAssignee({ kind })).toEqual({ kind });
			expect(assigneeLabel(validateAssignee({ kind }))).toBeTruthy();
		},
	);
	it("accepts a human assignee without granting reviewer authority", () => {
		const value = validateAssignee({
			kind: "human",
			id: "alice",
			name: " Alice ",
			isDoradsoft: true,
		});
		expect(value).toEqual({ kind: "human", id: "alice", name: "Alice" });
		expect(assigneeLabel(value)).toBe("Alice");
	});
	it.each([
		{ kind: "bot" },
		{ kind: "human", id: "", name: "Alice" },
		{ kind: "human", id: "alice", name: "" },
	])("rejects invalid assignee %j", (value) =>
		expect(() => validateAssignee(value)).toThrow(),
	);
	it("normalizes evidence and permits only web URLs", () => {
		expect(validateEvidence([{ citation: " בראשית א א " }])).toEqual([
			{ citation: "בראשית א א", quote: "", url: null, note: "" },
		]);
		expect(
			validateEvidence([
				{
					citation: "Source",
					url: "https://example.com",
					quote: "quote",
					note: "note",
				},
			])[0].quote,
		).toBe("quote");
		expect(() =>
			validateEvidence([{ citation: "source", url: "javascript:alert(1)" }]),
		).toThrow("http");
		expect(() => validateEvidence(null)).toThrow();
		expect(() =>
			validateEvidence(Array(31).fill({ citation: "source" })),
		).toThrow();
	});
	it("normalizes parent-child operations and nullable metadata", () =>
		expect(validateChange(parent)).toEqual({
			kind: "parent_child",
			targetId: undefined,
			after: {
				...parent.after,
				sourceCitation: null,
				altGroupId: null,
				birthOrder: null,
			},
		}));
	it.each(["BIOLOGICAL", "ADOPTIVE", "STEP", "FOSTER"])(
		"accepts %s relationships",
		(relationshipType) =>
			expect(
				validateChange({
					...parent,
					after: {
						...parent.after,
						relationshipType,
						birthOrder: 3,
						altGroupId: OTHER,
						sourceCitation: "בראשית א א",
					},
				}).kind,
			).toBe("parent_child"),
	);
	it("rejects self-parent relationships and non-positive birth orders", () => {
		expect(() =>
			validateChange({ ...parent, after: { ...parent.after, childId: ID } }),
		).toThrow("own parent");
		for (const birthOrder of [0, -1, 1.5, Infinity, "2"])
			expect(() =>
				validateChange({ ...parent, after: { ...parent.after, birthOrder } }),
			).toThrow();
	});
	it("supports all union fields without dropping citations", () => {
		const change = validateChange({
			kind: "union",
			targetId: ID,
			after: {
				person1Id: ID,
				person2Id: OTHER,
				unionType: "MARRIAGE",
				unionOrder: 2,
				startDate: 100101,
				endDate: 100201,
				endReason: "DIVORCE",
				sourceCitation: "בראשית א א",
				personSourceCitation: "בראשית ב א",
				altGroupId: ID,
			},
		});
		expect(change.after).toMatchObject({
			personSourceCitation: "בראשית ב א",
			endReason: "DIVORCE",
			unionOrder: 2,
		});
		expect(() =>
			validateChange({ ...change, after: { ...change.after, person2Id: ID } }),
		).toThrow("different people");
	});
	it("normalizes omitted union optional fields", () =>
		expect(
			validateChange({
				kind: "union",
				after: { person1Id: ID, person2Id: OTHER, unionType: "BETROTHAL" },
			}).after,
		).toMatchObject({
			unionOrder: null,
			endReason: null,
			startDate: null,
			endDate: null,
		}));
	it.each([
		[90, 180],
		[-90, -180],
		[0, 0],
		[31.778123456, 35.235432101],
	])("accepts valid paired coordinates %j", (latitude, longitude) =>
		expect(
			validateChange({
				kind: "place",
				after: { placeId: ID, latitude, longitude },
			}).kind,
		).toBe("place"),
	);
	it.each([
		[91, 0],
		[0, 181],
		[NaN, 0],
		[null, 12],
		[1, null],
		["31", 35],
	])("rejects invalid coordinates %j", (latitude, longitude) =>
		expect(() =>
			validateChange({
				kind: "place",
				after: { placeId: ID, latitude, longitude },
			}),
		).toThrow(),
	);
	it("permits an identification with no location yet", () =>
		expect(
			validateChange({
				kind: "place",
				after: { placeId: ID, modernName: "ירושלים" },
			}).after,
		).toMatchObject({
			latitude: null,
			longitude: null,
			modernName: "ירושלים",
		}));
	it("requires a real metadata target and forbids extra model fields", () => {
		expect(
			validateChange({
				kind: "metadata",
				targetId: ID,
				after: { displayName: "Name" },
			}),
		).toMatchObject({ targetId: ID });
		expect(() =>
			validateChange({ kind: "metadata", after: { displayName: "Name" } }),
		).toThrow();
		expect(() => validateChange({ ...parent, sql: "DROP TABLE" })).toThrow(
			"Unsupported",
		);
	});
	it.each([
		"PERSON",
		"PLACE",
		"EVENT",
		"ANIMAL",
		"OBJECT",
		"PLANT",
		"ASTRONOMICAL_OBJECT",
		"SAYING",
		"SEFER",
		"NATION",
	])("accepts metadata-only new %s entries", (entityType) =>
		expect(
			validateChange({
				kind: "entry",
				after: {
					title: "כותרת",
					uniqueName: "שם",
					entityType,
					displayName: "שם",
				},
			}).kind,
		).toBe("entry"),
	);
	it.each(["body", "content", "contentHtml", "sql"])(
		"rejects %s on a new entry",
		(field) =>
			expect(() =>
				validateChange({
					kind: "entry",
					after: {
						title: "Title",
						uniqueName: "name",
						entityType: "PERSON",
						displayName: "Name",
						[field]: "invented prose",
					},
				}),
			).toThrow("Unsupported"),
	);
	it.each(["a/b", "a%20b", "a?x", "a#x", "a\\b"])(
		"rejects invalid new-entry paths %s",
		(uniqueName) =>
			expect(() =>
				validateChange({
					kind: "entry",
					after: {
						title: "Title",
						uniqueName,
						entityType: "PERSON",
						displayName: "Name",
					},
				}),
			).toThrow("path"),
	);
	it.each(["parent_child", "union", "place"])(
		"allows explicit %s deletion by stable target ID",
		(kind) =>
			expect(validateChange({ kind, targetId: ID, after: null })).toEqual({
				kind,
				targetId: ID,
				after: null,
			}),
	);
	it.each(["entry", "metadata"])("forbids %s deletion", (kind) =>
		expect(() => validateChange({ kind, targetId: ID, after: null })).toThrow(),
	);
	it("enforces batch bounds and rejects duplicate targets", () => {
		expect(() => validateChanges([])).toThrow();
		expect(() => validateChanges(Array(41).fill(parent))).toThrow();
		expect(() =>
			validateChanges([
				{ ...parent, targetId: ID },
				{ ...parent, targetId: ID },
			]),
		).toThrow("once");
		expect(validateChanges([parent])).toHaveLength(1);
	});
});

describe("PR approval rule", () => {
	it("requires doradsoft approval and never trusts a display name", () => {
		const item = pr();
		item.author.name = "doradsoft";
		expect(reviewStatus(item)).toBe("required");
		expect(() => assertMergeAllowed(item)).toThrow("doradsoft");
	});
	it("exempts doradsoft-authored human PRs", () => {
		const item = pr();
		item.author = doradsoft;
		expect(reviewStatus(item)).toBe("exempt");
		expect(() => assertMergeAllowed(item)).not.toThrow();
	});
	it("does not retain the owner's exemption after someone else edits the current revision", () => {
		const item = pr();
		item.author = doradsoft;
		item.revisionAuthor = human;
		expect(reviewStatus(item)).toBe("required");
		expect(() => assertMergeAllowed(item)).toThrow("doradsoft");
		item.revisionAuthor = doradsoft;
		expect(reviewStatus(item)).toBe("exempt");
	});
	it.each(["local_llm", "aws_llm"] as const)(
		"never exempts %s even with a forged display name",
		(kind) => {
			const item = pr();
			item.author = { ...doradsoft, kind };
			expect(reviewStatus(item)).toBe("required");
		},
	);
	it("only counts a trusted human review of the current revision", () => {
		const item = pr();
		item.events.push({
			id: ID,
			kind: "approved",
			actor: doradsoft,
			body: "",
			at: "",
			revision: 1,
		});
		expect(reviewStatus(item)).toBe("approved");
		expect(() => assertMergeAllowed(item)).not.toThrow();
		item.revision = 2;
		expect(reviewStatus(item)).toBe("required");
		item.events.push({
			id: OTHER,
			kind: "approved",
			actor: { ...doradsoft, kind: "local_llm" },
			body: "",
			at: "",
			revision: 2,
		});
		expect(reviewStatus(item)).toBe("required");
	});
	it("uses the latest applicable review", () => {
		const item = pr();
		for (const kind of ["approved", "changes_requested", "approved"] as const) {
			item.events.push({
				id: crypto.randomUUID(),
				kind,
				actor: doradsoft,
				body: "",
				at: "",
				revision: 1,
			});
			expect(reviewStatus(item)).toBe(kind);
		}
	});
	it("never merges closed items, issues, or empty proposals", () => {
		const item = pr();
		item.author = doradsoft;
		item.state = "closed";
		expect(() => assertMergeAllowed(item)).toThrow();
		item.state = "open";
		item.kind = "issue";
		expect(() => assertMergeAllowed(item)).toThrow();
		item.kind = "pr";
		item.evidence = [];
		expect(() => assertMergeAllowed(item)).toThrow("evidence");
	});
});

describe("domain diff", () => {
	it("compares canonical state regardless of object key order", () =>
		expect(sameState({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true));
	it("lists changed fields including additions and removals", () => {
		const change = pr().changes[0];
		expect(changedFields(change)).toEqual(["displayName"]);
		expect(changedFields({ ...change, before: null })).toEqual(["displayName"]);
		expect(changedFields({ ...change, after: null })).toEqual(["displayName"]);
		expect(changedFields({ ...change, after: change.before })).toEqual([]);
	});
});
